const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
const { FuseState } = require('@electron/fuses/dist/constants')
const expected = {
  RunAsNode: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE,
}
getCurrentFuseWire(process.argv[2]).then(wire => {
  for (const [name, value] of Object.entries(expected)) {
    if (wire[FuseV1Options[name]] !== value) throw new Error(`Unexpected fuse: ${name}`)
  }
  console.log('All five security fuses verified')
}).catch(error => { console.error(error); process.exitCode = 1 })
