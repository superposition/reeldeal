// Reviewed public artifact, pinned to a content revision as well as hashes.
// Refresh only after reviewing the new graph, weights, tokenizer and config.
export const LAYA_MODEL = {
  id: 'laya-typed-decisions',
  variant: 'q4e8',
  revision: 'dd0c52a2b563bea25279e2689689061dd0a1c382',
  base: 'https://huggingface.co/VishalMysore/layaForWebTrained/resolve/dd0c52a2b563bea25279e2689689061dd0a1c382/',
  manifestVersion: 1,
  chunkBytes: 25_165_824,
  graph: 'laya_q4e8.onnx',
  graphBytes: 3_570_507,
  graphSha256: 'd50142445467421f168baa5c9eb1a1153a038d721fb8cb0920c76b98d6e584b8',
  assetHashes: {
    manifest: '516492b83fc3f8fc6009d66bf24c41de5c318cd943124a4379305b375a856443',
    tokenizer: '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30',
    tokenizerConfig: '08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1',
    config: 'ebf0cd524d92342a6be5e48e9fca3d7c2babfb5a56ccd79d2171ef5d8c7f7be8',
  },
  weights: {
    name: 'laya_q4e8.onnx.data',
    bytes: 291_127_040,
    sha256: 'de4960a6ee6f39e7eed4c5781cd9694faf1f99fc95bd6953ca8aa14a6ffb055b',
    parts: 12,
  },
  maxLen: 1024,
  headMaxLen: 256,
} as const;
