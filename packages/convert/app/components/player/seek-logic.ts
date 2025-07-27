import {WEBCODECS_TIMESCALE} from '@remotion/media-parser';
import {
	findGroupForInsertingTimestamp,
	type FrameDatabase,
} from './frame-database';

export const isSeekInfeasible = (
	frameDatabase: FrameDatabase,
	firstFrameTime: number,
	seekToSeconds: number,
) => {
	const group = findGroupForInsertingTimestamp({
		groups: frameDatabase._groups,
		timestamp: firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE,
	});

	// if there are no frames yet, they will arrive
	if (group?.frames.length === 0) {
		return false;
	}

	// If every frame is already past the seek, we cannot do anything
	if (
		group.frames.every(
			(f) =>
				f.frame.timestamp >
				firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE,
		)
	) {
		return true;
	}

	return false;
};

export const isSeekAchieved = ({
	frameDatabase,
	firstFrameTime,
	seekToSeconds,
}: {
	frameDatabase: FrameDatabase;
	firstFrameTime: number;
	seekToSeconds: number;
}) => {
	const group = findGroupForInsertingTimestamp({
		groups: frameDatabase._groups,
		timestamp: firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE,
	});

	const hasFrameWithin01Seconds = group.frames.some(
		(f) =>
			Math.abs(
				f.frame.timestamp -
					(firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE),
			) <
			0.1 * WEBCODECS_TIMESCALE,
	);

	// If there are frames very close by, we consider the seek achieved.
	if (hasFrameWithin01Seconds) {
		return true;
	}

	// But there are also variable FPS videos, we can also
	// determine if there are frames before and after the seek
	// and consider the seek done.
	const hasFramesAfter = group.frames.some(
		(f) =>
			f.frame.timestamp > firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE,
	);
	const hasFramesBefore = group.frames.some(
		(f) =>
			f.frame.timestamp < firstFrameTime + seekToSeconds * WEBCODECS_TIMESCALE,
	);

	return hasFramesAfter && hasFramesBefore;
};

export const getGroupOfIntendedSeek = (
	frameDatabase: FrameDatabase,
	firstFrameTime: number,
	simulatedSeekTimestampInSeconds: number,
) => {
	const group = frameDatabase
		.getGroups()
		.find(
			(g) =>
				Math.abs(
					g.startingTimestamp -
						(firstFrameTime +
							simulatedSeekTimestampInSeconds * WEBCODECS_TIMESCALE),
				) <
				0.1 * WEBCODECS_TIMESCALE,
		);

	return group ?? null;
};

export const SEEK_TOLERANCE_IN_SECONDS = 0.1;
