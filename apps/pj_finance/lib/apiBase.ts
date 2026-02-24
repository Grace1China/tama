/** 与 next.config.js basePath 一致，用于前端请求 API 时加前缀，避免部署在 /finance 下时请求到错误路径 */
export const apiBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
