/**
 * 共享包入口 - 两个项目共用的工具、类型、组件等可放于此
 * 在 app 中: import { sharedVersion } from 'shared'
 */

export const sharedVersion = '0.1.0';

export function greet(name: string): string {
  return `Hello, ${name}`;
}
