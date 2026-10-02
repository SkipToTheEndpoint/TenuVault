import { typeForFolder } from "../../../shared/intune/registry"
export function validPolicyPath(path: unknown, backupId: string): path is string {
  return typeof path === 'string' && !/[\\\u0000-\u001f]/.test(path) &&
    path.split('/').length === 3 && path.split('/')[0] === backupId &&
    (!!typeForFolder(path.split('/')[1] ?? '') || /^DeviceCompliancePolicies$/i.test(path.split('/')[1] ?? '')) &&
    !!path.split('/')[2]?.endsWith('.json') && !path.split('/').some(part => part === '..' || part === '.')
}
