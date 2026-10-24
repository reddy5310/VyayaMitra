/**
 * Sample-data starter. `@/db/sample` is added by the ledger module; it is resolved lazily so this
 * screen keeps working (and the build stays green) in builds where it does not exist yet.
 */
type SampleModule = { startSampleData?: () => Promise<unknown> };

const loaders = import.meta.glob<SampleModule>('/src/db/sample.ts');

export const sampleDataAvailable = Object.keys(loaders).length > 0;

export async function startSample(): Promise<void> {
  const load = Object.values(loaders)[0];
  const mod = load ? await load() : undefined;
  if (!mod?.startSampleData) throw new Error('Sample data is not available in this version.');
  await mod.startSampleData();
}
