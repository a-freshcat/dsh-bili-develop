import { assert, errorView } from './errors.mjs';

// Visual evaluation adapter. Frames are admitted into the bound Session as
// base64 image parts; this module never creates a session or sends a comment.
export const FRAME_MEDIA_TYPE = 'image/jpeg';

export function visionReady(config, evidence) {
  return config.visionEnabled === true && evidence?.source !== 'comments' &&
    Number.isInteger(evidence?.cid) && evidence.cid > 0;
}

/**
 * Sample uniform frames for one already-read video.
 * Returns null when vision is off or the video cannot supply a stream, so the
 * caller can fall back to the text-only path without failing the run.
 */
export async function sampleFrames(controller, run, evidence, config) {
  if (!visionReady(config, evidence)) return null;
  if (run.roundId) assert(!controller.scheduler.paused, 'BROWSING_PAUSED', '浏览已暂停，未开始抽帧。', 409);
  const ready = await controller.reader().call('vision_check', {}, 30000);
  if (controller.closed) return null;
  assert(ready?.ready === true, 'VISION_NOT_READY', ready?.message || '本机抽帧依赖未就绪，请在高级设置检查。');
  if (run.roundId) assert(!controller.scheduler.paused, 'BROWSING_PAUSED', '浏览已暂停，未开始抽帧。', 409);

  const seconds = Math.max(1, Math.min(Math.ceil(evidence.duration || 0), 3600));
  const job = controller.store.reserveFrames(run.id, seconds, controller.now());
  controller.store.update(run.id, { readStage: 'frames', frames: job });
  try {
    const result = await controller.reader().call('sample_frames', {
      bvid: run.bvid, cid: evidence.cid, expected_account: evidence.accountUid,
      frames: job.frames, budget_seconds: job.seconds,
      timeout_seconds: config.visionTimeoutSeconds,
    }, (config.visionTimeoutSeconds + 10) * 1000);
    if (controller.closed) return null;
    const frames = validateFrames(result, run, evidence, job);
    const framesState = controller.store.finishFrames(run.id, { state: 'completed', totalFrames: frames.length });
    controller.store.update(run.id, { frames: framesState, readStage: 'complete' });
    return {
      source: 'frames',
      coverage: result.coverage,
      processedRanges: [{ from: 0, to: result.processedSeconds }],
      processedSeconds: result.processedSeconds,
      frames,
      totalFrames: frames.length,
      processor: result.processor,
    };
  } catch (error) {
    if (!controller.closed) {
      const framesState = controller.store.finishFrames(run.id, { state: 'failed', error: errorView(error) });
      controller.store.update(run.id, { frames: framesState });
    }
    throw error;
  }
}

function validateFrames(result, run, evidence, job) {
  assert(result && result.bvid === run.bvid && result.cid === evidence.cid &&
    result.accountUid === evidence.accountUid && result.source === 'frames' &&
    Array.isArray(result.frames) && result.frames.length > 0 && result.frames.length <= job.frames &&
    Number.isFinite(result.processedSeconds) && result.processedSeconds > 0 &&
    result.processedSeconds <= (evidence.duration || 0) + 0.5 && ['partial', 'complete'].includes(result.coverage),
  'INVALID_EVIDENCE', '抽帧结果的来源、账号、分P或覆盖范围无效。');
  let last = -1;
  return result.frames.map(frame => {
    assert(frame && Number.isFinite(frame.at) && frame.at > last && frame.at <= result.processedSeconds + 0.5 &&
      typeof frame.data === 'string' && frame.data.length > 0 && frame.data.length <= 2_000_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(frame.data) &&
      Number.isInteger(frame.width) && frame.width > 0 && frame.width <= 4096 &&
      Number.isInteger(frame.height) && frame.height > 0 && frame.height <= 4096,
    'INVALID_EVIDENCE', '画面帧的时间、尺寸或编码无效。');
    last = frame.at;
    return { at: frame.at, data: frame.data, width: frame.width, height: frame.height, mediaType: FRAME_MEDIA_TYPE };
  });
}

/** Prompt content: instruction text first, then the frames in time order. */
export function frameParts(frames) {
  return frames.map((frame, index) => ({
    type: 'image',
    mediaType: frame.mediaType,
    data: frame.data,
    name: 'frame-' + String(index + 1).padStart(2, '0') + '-t' + frame.at.toFixed(1) + 's.jpg',
  }));
}
