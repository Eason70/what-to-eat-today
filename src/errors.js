export class ServiceError extends Error {
  constructor(code, message = '') { super(message || code); this.name = 'ServiceError'; this.code = code; }
}
export function friendlyError(error) {
  const messages = {
    OFFLINE: '当前离线，查找餐馆和地点需要联网。仍可随机餐食。',
    NOT_CONFIGURED: '查店服务尚未配置，暂时无法查找真实门店。仍可随机餐食。',
    JS_NOT_CONFIGURED: '自动定位尚未配置，可尝试搜索地点设置中心。',
    KEY_INVALID: '地图服务凭据或域名配置有误，请联系站点维护者。',
    FORBIDDEN: '地图服务权限不足，请联系站点维护者检查配置。',
    QUOTA: '地图服务额度或请求频率已达限制，请稍后重试。',
    RATE_LIMIT: '操作较频繁，请稍后重试。',
    TIMEOUT: '地图服务响应超时，请重试。',
    NETWORK: '暂时无法连接地图服务，请检查网络后重试。',
    UPSTREAM: '地图服务暂时不可用，请稍后重试。',
    INVALID_RESPONSE: '地图服务返回了无法识别的数据，请稍后重试。',
    LOCATION_DENIED: '未获定位权限，可在浏览器中开启权限，或搜索地点。',
    LOCATION_FAILED: '暂时无法获取位置，请重试或搜索地点。',
    SDK_LOAD: '定位组件未能加载，请重试或搜索地点。',
    HTTPS_REQUIRED: '定位需要 HTTPS 安全连接，可先搜索地点。',
    BAD_REQUEST: '搜索参数无效，请重新选择位置和范围。',
  };
  return messages[error?.code] || '暂时无法完成，请重试。';
}
