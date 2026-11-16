// Same six-tool facade as Forge (src/contracts/facade.ts, commit 6998b99), gameplay namespace.
export const facadeTools = [
    { name: 'gameplay_describe', description: 'Discover games, scenarios, capabilities and availability, or the schema of one operation.' },
    { name: 'gameplay_query', description: 'Run an available read-only operation (doctor, evidence reads, diff) with compact paged results.' },
    { name: 'gameplay_propose', description: 'Create a run plan with its staging writes and return its hash; never writes.' },
    { name: 'gameplay_apply', description: 'Apply the staging writes of an exact, locally approved plan.' },
    { name: 'gameplay_job', description: 'Start, poll or cancel a scenario, run-all or build job.' },
    { name: 'gameplay_artifact', description: 'Read a bounded chunk of a run artifact (log, frame index, report).' },
] as const;
