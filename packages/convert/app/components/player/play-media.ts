import type {
	MediaParserDimensions,
	ParseMediaSrc,
} from '@remotion/media-parser';
import {
	hasBeenAborted,
	mediaParserController,
	parseMedia,
	WEBCODECS_TIMESCALE,
} from '@remotion/media-parser';
import type {WebCodecsVideoDecoder} from '@remotion/webcodecs';
import {createVideoDecoder, webcodecsController} from '@remotion/webcodecs';
import {makeFrameDatabase} from './frame-database';
import {makePlaybackState} from './playback-state';
import {
	getGroupOfIntendedSeek,
	isSeekAchieved,
	isSeekInfeasible,
	SEEK_TOLERANCE_IN_SECONDS,
} from './seek-logic';
import {throttledSeek} from './throttled-seek';

export const playMedia = ({
	src,
	signal,
	onDimensions,
	onDurationInSeconds,
	onError,
	drawFrame,
	loop,
}: {
	src: ParseMediaSrc;
	signal: AbortSignal;
	onDimensions: (dim: MediaParserDimensions | null) => void;
	onDurationInSeconds: (duration: number | null) => void;
	drawFrame: (frame: VideoFrame) => boolean;
	onError: (err: Error) => void;
	loop: boolean;
}) => {
	const wcController = webcodecsController();
	const mpController = mediaParserController();

	const frameDatabase = makeFrameDatabase();
	const playback = makePlaybackState({frameDatabase, drawFrame});

	let decoder: WebCodecsVideoDecoder | null = null;
	let lastKeyframeTimestamp: number | null = null;

	const seek = throttledSeek((time: number) => {
		decoder!.reset();

		mpController.seek(time);
		mpController.resume();
	});

	const onAbort = () => {
		mpController.abort();
	};

	signal.addEventListener('abort', onAbort);

	parseMedia({
		src,
		acknowledgeRemotionLicense: true,
		controller: mpController,
		onDimensions,
		onDurationInSeconds,
		onVideoTrack: ({track}) => {
			console.log('Video track', track);
			let loopIteration = 0;
			decoder = createVideoDecoder({
				onError: (err) => {
					onError(err);
					mpController.abort();
				},
				onFrame: (frame) => {
					// Some files can start with a frame that doesn't start at 0.
					// Example: https://test-streams.mux.dev/x36xhzz/url_6/193039199_mp4_h264_aac_hq_7.m3u8
					if (frameDatabase.getLength() === 0) {
						playback.setFirstFrameTime(frame.timestamp);
					}

					const desiredSeek = seek.getDesiredSeek();

					if (desiredSeek) {
						if (
							frame.timestamp <
							(desiredSeek.getDesired() - SEEK_TOLERANCE_IN_SECONDS) *
								WEBCODECS_TIMESCALE
						) {
							// Don't draw if we are seeking to a later frame
							frame.close();
							return;
						}

						frameDatabase.addFrame(frame, loopIteration);

						if (isSeekInfeasible(frameDatabase, desiredSeek.getDesired())) {
							seek.replaceWithNewestSeek();
							return;
						}

						if (
							isSeekAchieved({
								frameDatabase,
								firstFrameTime: playback.getFirstFrameTime(),
								seekToSeconds: desiredSeek.getDesired(),
							})
						) {
							seek.clearSeek();
							playback.drawImmediately();
							return;
						}
					}

					frameDatabase.addFrame(frame, loopIteration);
					playback.drawImmediately();
				},
				track,
				controller: wcController,
			});

			return async (sample) => {
				if (sample.type === 'key') {
					lastKeyframeTimestamp = Math.min(
						sample.timestamp,
						sample.decodingTimestamp,
					);
					frameDatabase.startNewGop(sample);
				}

				const {wasReset} = decoder!.checkReset();

				await decoder!.waitForQueueToBeLessThan(20);
				if (wasReset()) {
					return;
				}

				await frameDatabase.waitForQueueToBeLessThan(15);
				if (wasReset()) {
					return;
				}

				console.log('Decoding sample', sample);
				await decoder!.decode(sample);
				if (wasReset()) {
					return;
				}

				return async () => {
					await decoder!.flush();
					if (wasReset()) {
						return;
					}

					frameDatabase.setLastFrame();
					mpController.pause();

					if (loop) {
						loopIteration++;
						seek.queueSeek(0, frameDatabase);
					}
				};
			};
		},
	})
		.catch((err) => {
			if (!hasBeenAborted(err)) {
				onError(err);
			} else {
				console.log('aborted');
			}
		})
		.finally(() => {
			signal.removeEventListener('abort', onAbort);
		});

	return {
		play: () => {
			playback.play();
		},
		pause: () => {
			playback.pause();
		},
		isPlaying: () => {
			return playback.isPlaying();
		},
		getCurrentTime: () => {
			return playback.getCurrentTime();
		},
		seek: async (time: number) => {
			console.log('[PlayMedia] Seeking to', time);
			playback.setCurrentTime(time * WEBCODECS_TIMESCALE);

			// If the right frame is already in the database, we can draw it immediately
			console.log(
				'isSeekAchieved',
				isSeekAchieved({
					frameDatabase,
					firstFrameTime: playback.getFirstFrameTime(),
					seekToSeconds: time,
				}),
			);
			if (
				isSeekAchieved({
					frameDatabase,
					firstFrameTime: playback.getFirstFrameTime(),
					seekToSeconds: time,
				})
			) {
				seek.clearSeek();
				mpController.resume();
				playback.drawImmediately();
				return;
			}

			const simulatedSeek = await mpController.simulateSeek(time);
			console.log('simulatedSeek', simulatedSeek);

			if (simulatedSeek.type === 'do-seek') {
				console.log(
					'get group at',
					playback.getFirstFrameTime(),
					simulatedSeek.timeInSeconds,
				);
				console.log('frameDatabase', frameDatabase);
				const group = getGroupOfIntendedSeek(
					frameDatabase,
					playback.getFirstFrameTime(),
					simulatedSeek.timeInSeconds,
				);
				console.log('group', group);
				console.log('lastKeyframeTimestamp', lastKeyframeTimestamp);
				if (group && group.startingTimestamp === lastKeyframeTimestamp) {
					// we are in the same group, don't seek yet! maybe we can just wait
					const lastFrameInput = decoder!.getMostRecentSampleInput();

					// all frames are before the seek, we can just wait
					if (
						lastFrameInput &&
						lastFrameInput < playback.getInternalCurrentTime()
					) {
						frameDatabase.clearFramesBeforeTimestampFromGroup({
							deleteFramesBeforeTimestamp: playback.getInternalCurrentTime(),
							groupStartingTimestamp: group.startingTimestamp,
						});
						seek.setSeekWithoutMediaParserSeek(time);
						return;
					}

					frameDatabase.clearGroup(group.startingTimestamp);

					// we are already too far, we need to seek back to the beginning of the group.
					seek.queueSeek(time, frameDatabase);
					return;
				}
			}

			// was not able to simulate seek, I guess we just force the seek
			frameDatabase.clearDatabase();
			seek.queueSeek(playback.getFirstFrameTime(), time, frameDatabase);
		},
		addEventListener: playback.emitter.addEventListener,
		removeEventListener: playback.emitter.removeEventListener,
		frameDatabase,
	};
};

export type Player = ReturnType<typeof playMedia>;
