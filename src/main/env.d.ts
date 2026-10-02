/** electron-vite copies `?asset` imports next to the bundle and returns their path. */
declare module "*?asset" {
  const path: string
  export default path
}
