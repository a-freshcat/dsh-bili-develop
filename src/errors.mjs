export class PluginError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function errorView(error) {
  if (error instanceof PluginError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: '操作未完成，请检查宿主服务和读取环境。' };
}
export function assert(condition, code, message, status) {
  if (!condition) throw new PluginError(code, message, status);
}
