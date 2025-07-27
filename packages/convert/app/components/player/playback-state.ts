import type {FrameDatabase} from './frame-database';
import {PlayerEmitter} from './player-event-emitter';

export const makePlaybackState = ({
	frameDatabase,
	drawFrame,
}: {
	frameDatabase: FrameDatabase;
	drawFrame: (frame: VideoFrame) => void;
}) => {
	let currentTime = 0;
	let firstFrameTime = 0;
	let playing = false;
	let playTimeout: NodeJS.Timeout | null = null;
	const emitter = new PlayerEmitter();
	let lastFrameDrawn: number | null = null;

	const clearPlayTimeout = () => {
		if (playTimeout) {
			clearTimeout(playTimeout);
		}
	};

	const getCurrentTime = () => {
		return currentTime;
	};

	const isPlaying = () => {
		return playing;
	};

	const setCurrentTime = (time: number) => {
		const hasChanged = currentTime !== time;
		currentTime = time;
		if (hasChanged) {
			emitter.dispatchTimeUpdate(time);
		}
	};

	const setFirstFrameTime = (time: number) => {
		firstFrameTime = time;
	};

	const getFirstFrameTime = () => {
		return firstFrameTime;
	};

	const getInternalCurrentTime = () => {
		return firstFrameTime + currentTime;
	};

	const emitFrame = (frame: VideoFrame) => {
		if (lastFrameDrawn === frame.timestamp) {
			return;
		}

		lastFrameDrawn = frame.timestamp;
		drawFrame(frame);
	};

	const loop = () => {
		const nextFrame = frameDatabase.getNextFrameForTimestamp(
			getInternalCurrentTime(),
			true,
		);
		if (!nextFrame) {
			throw new Error('No frame found for time: ' + getInternalCurrentTime());
		}

		return setTimeout(
			() => {
				if (!isPlaying()) {
					return;
				}

				emitFrame(nextFrame.frame);
				setCurrentTime(nextFrame.frame.timestamp - firstFrameTime);
				nextFrame.frame.close();

				loop();
			},
			(nextFrame.frame.timestamp - firstFrameTime - getCurrentTime()) / 1000,
		);
	};

	const drawImmediately = () => {
		const nextFrame = frameDatabase.getNextFrameForTimestamp(
			getInternalCurrentTime(),
			false,
		);

		if (!nextFrame) {
			return;
		}

		emitFrame(nextFrame.frame);
	};

	const pause = () => {
		playing = false;
		clearPlayTimeout();
		emitter.dispatchPause();
	};

	const play = () => {
		playing = true;
		playTimeout = loop();
		emitter.dispatchPlay();
	};

	return {
		setCurrentTime,
		getCurrentTime,
		setFirstFrameTime,
		getFirstFrameTime,
		getInternalCurrentTime,
		isPlaying,
		pause,
		play,
		emitter,
		drawImmediately,
		getCurrentlyDrawnFrame: () => {
			return lastFrameDrawn;
		},
	};
};
