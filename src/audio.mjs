import { assert, errorView } from './errors.mjs';

// Local ASR only. This adapter never creates a DSH session or sends a comment.
export async function transcribeFallback(controller, run, evidence, config) {
  if (evidence.source === 'comments' || !config.asrEnabled || evidence.text?.trim()) return evidence;
  assert(Number.isFinite(evidence.duration) && evidence.duration > 0 && Number.isInteger(evidence.cid) && evidence.cid > 0,
    'AUDIO_METADATA', '缺少可核对的音频时长或分P标识，未发起转写。');
  if (run.roundId) assert(!controller.scheduler.paused, 'BROWSING_PAUSED', '浏览已暂停，未开始音频转写。', 409);
  const ready = await controller.reader().call('audio_check', { model_path: config.asrModelPath }, 30000);
  if (controller.closed) return evidence;
  assert(ready?.ready === true, 'AUDIO_NOT_READY', ready?.message || '本地转写环境未就绪，请在高级设置检查。');
  if (run.roundId) assert(!controller.scheduler.paused, 'BROWSING_PAUSED', '浏览已暂停，未开始音频转写。', 409);
  const job = controller.store.reserveAudio(run.id, evidence.duration, controller.now());
  controller.store.update(run.id, { readStage: 'audio', audio: job });
  try {
    const result = await controller.reader().call('transcribe_video', {
      bvid: run.bvid, cid: evidence.cid, expected_account: evidence.accountUid,
      seconds: job.seconds, model_path: config.asrModelPath, max_chars: config.maxContentChars,
      timeout_seconds: config.audioTimeoutSeconds,
    }, (config.audioTimeoutSeconds + 10) * 1000);
    if (controller.closed) return evidence;
    assert(result?.bvid === run.bvid && result.cid === evidence.cid && result.accountUid === evidence.accountUid &&
      result.source === 'asr' && typeof result.text === 'string' && Array.isArray(result.segments) &&
      Number.isFinite(result.processedSeconds) && result.processedSeconds > 0 && result.processedSeconds <= job.seconds + 0.1 &&
      Array.isArray(result.processedRanges) && result.processedRanges.length === 1 &&
      result.processedRanges[0]?.from === 0 && result.processedRanges[0]?.to === result.processedSeconds &&
      ['partial', 'complete', 'none'].includes(result.coverage) &&
      (result.coverage !== 'none' || (!result.text.trim() && result.segments.length === 0)), 'INVALID_EVIDENCE', '转写结果的来源、账号、分P或覆盖范围无效。');
    let last = 0;
    for (const segment of result.segments) {
      assert(typeof segment.text === 'string' && Number.isFinite(segment.from) && Number.isFinite(segment.to) &&
        segment.from >= last && segment.to > segment.from && segment.to <= result.processedSeconds + 0.1,
      'INVALID_EVIDENCE', '转写片段超出实际处理区间。');
      last = segment.to;
    }
    assert(result.text === result.segments.map(s => s.text).join('\n') && result.text.length <= config.maxContentChars,
      'INVALID_EVIDENCE', '转写正文与时间片段不一致或超出预算。');
    const audio = controller.store.finishAudio(run.id, { state: 'completed', processedSeconds: result.processedSeconds });
    controller.store.update(run.id, { audio, readStage: 'complete' });
    return { ...evidence, ...result };
  } catch (error) {
    if (!controller.closed) {
      const audio = controller.store.finishAudio(run.id, { state: 'failed', error: errorView(error) });
      controller.store.update(run.id, { audio });
    }
    throw error;
  }
}
