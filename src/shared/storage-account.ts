/** Account names become credential-bearing URL hosts. */
export function assertStorageAccountName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || (!/^[a-z0-9]{3,24}$/.test(name) && !/^tvlocal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name))) {
    throw new Error('Invalid storage account name.')
  }
}
