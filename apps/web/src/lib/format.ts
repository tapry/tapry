/** "840 KB", "12.3 MB", "1.4 GB": sizes in storage, base 1024. */
export function formatBytes(bytes: number) {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${value} bytes`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
