/* Isolated native parsing. No network fetch, path input, signing or persistent media storage. */
import { parentPort, workerData } from 'node:worker_threads';
import { Reader } from '@contentauth/c2pa-node';
try {
  const reader = await Reader.fromAsset(
    { buffer: Buffer.from(workerData.bytes), mimeType: workerData.mimeType },
    { verify: { verify_after_reading: true, remote_manifest_fetch: false, ocsp_fetch: false } },
  );
  if (!reader) parentPort.postMessage({ absent: true });
  else {
    const json = reader.json(),
      active = reader.getActive();
    parentPort.postMessage({
      state: json.validation_state,
      results: json.validation_results,
      status: json.validation_status,
      signature: active?.signature_info,
    });
  }
} catch (e) {
  parentPort.postMessage({ error: String(e.message).slice(0, 400) });
}
