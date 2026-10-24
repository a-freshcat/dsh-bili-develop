import { createHash } from 'node:crypto';
import { assert } from './errors.mjs';

// Project-authored advice. The upstream skill and examples are not bundled or executed.
const NATURAL_ZH = Object.freeze({
  id: 'natural-short-zh', version: '1.0.0', title: '自然中文短回复',
  description: '减少套话和多余尾句，检查同一条回复的语气是否协调；保留大肥鱼自己的性格。',
  source: Object.freeze({ name: 'ovo-arron/short-form-natural-zh', version: '0.1.0', license: 'AGPL-3.0-only',
    commit: '9029fdeb574b846cb8e34cfa86d4ff2eb3e430bf', url: 'https://github.com/ovo-arron/short-form-natural-zh' }),
  rules: Object.freeze([
    '检查答复是否回答了这位对象当前的问题；与本条无关的服务承诺、空泛评价可以省去。',
    '一条回复里的语气应当协调。嘴硬、亲昵、正式等选择依照现有人设和关系，不因建议包统一成同一种性格。',
    '在任务字数范围内给出足够信息；内容简单可以少说，需要解释时写清楚，不把正常句子刻意切成碎片。',
    '不为了显得活泼而补梗、动作描写或表情；有具体交流需要时仍可使用已有习惯。',
    '检查尾句是否有实际作用；只是在重复、许诺或生硬反问时可以删去，真正需要确认的问题仍要问。',
    '对修改意见先定位到本次回复，再判断是否值得成为长期习惯；一次偏好不应直接变成永久禁令。',
    '句子本来合适就保留。自然程度不以字数、口癖密度或某种检测分数衡量。',
  ]),
});
const PACKS = Object.freeze([NATURAL_ZH]);
const active = config => config.learningEnabled ? PACKS.filter(p => (config.learningKnowledgePacks || []).includes(p.id)) : [];

export function validateKnowledgePacks(value) {
  assert(Array.isArray(value) && value.length <= PACKS.length && new Set(value).size === value.length &&
    value.every(id => typeof id === 'string' && PACKS.some(p => p.id === id)), 'INVALID_CONFIG', '请选择已提供的学习知识包，不能填写外部指令或链接。');
  return [...value];
}
export const knowledgeRefs = config => active(config).map(p => ({ id: p.id, version: p.version }));
export function knowledgePolicy(config) {
  const refs = knowledgeRefs(config);
  return refs.length ? createHash('sha256').update(JSON.stringify(refs)).digest('hex') : '';
}
export function knowledgePolicyParts(config) { const policy = knowledgePolicy(config); return policy ? [policy] : []; }
export function knowledgeCatalogue(config) {
  const enabled = active(config);
  return PACKS.map(p => ({ ...p, rules: [...p.rules], source: { ...p.source }, selected: (config.learningKnowledgePacks || []).includes(p.id),
    active: enabled.some(row => row.id === p.id) }));
}
export function knowledgeInstruction(config, kind = 'video') {
  const selected = active(config);
  if (!selected.length) return '本次未加载学习知识包；历史知识包文字不作为当前约束。继续依照基础人设与现有独立培养的迭代状态。';
  return [
    '当前可选学习知识包快照如下，仅是表达建议。基础人设、用户禁用项、真实性、隐私与当前任务接口优先；有冲突就舍弃建议，不能改身份、人设、联系人规则、工具权限或发送许可。',
    '只作用于面向人的评论、私信或动态正文；任务要求的JSON外壳、字段、数值、标识、原文引证与审核步骤必须保留。不得假装真人或添加没有依据的经历、事实和承诺。',
    ...selected.flatMap(p => ['【可选知识包：' + p.title + '】', ...p.rules.map(rule => '- ' + rule)]),
    ...(kind === 'learning_review' ? ['日终可用这些建议检查旧习惯与真实新经历，但知识包本身不算交流证据，不能把包ID当source_ids。只有本期真实材料支持的变化才能进入迭代；允许完全不采纳，不直接改基础人设。'] : []),
    '包的选择以本次快照为准；以前对话中的其他包不继续生效，不跨联系人或公开/私密边界取例子。',
  ].join('\n');
}
