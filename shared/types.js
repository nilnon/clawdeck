export var AgentStatus;
(function (AgentStatus) {
    AgentStatus["DISCONNECTED"] = "disconnected";
    AgentStatus["CONNECTING"] = "connecting";
    AgentStatus["CONNECTED"] = "connected";
    AgentStatus["ERROR"] = "error";
    AgentStatus["BUSY"] = "busy";
})(AgentStatus || (AgentStatus = {}));
export const PHASE_CATEGORIES = {
    blind_spot: ['model_resolving', 'prompt_building', 'llm_connecting', 'llm_first_token'],
    visible: ['thinking', 'generating', 'tool_calling', 'tool_executing', 'tool_complete'],
    terminal: ['completed', 'error', 'cancelled'],
};
export const PHASE_LABELS = {
    idle: '空闲',
    model_resolving: '模型解析中',
    prompt_building: '提示词构建中',
    llm_connecting: 'LLM 连接中',
    llm_first_token: '等待首个 Token',
    thinking: '思考中',
    generating: '生成回复中',
    tool_calling: '工具调用中',
    tool_executing: '工具执行中',
    tool_complete: '工具完成',
    completed: '已完成',
    error: '错误',
    cancelled: '已取消',
};
