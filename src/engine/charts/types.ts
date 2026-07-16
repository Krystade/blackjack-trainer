/**
 * Every cell value a strategy chart can hold.
 *
 * Pd/Ps are introduced by upcoming single-deck charts (see
 * docs/sources/verified-charts-transcription.md, 1D H17 section): pair-only
 * conditional actions that resolve on DAS. Pd = split if DAS else double;
 * Ps = split if DAS else stand. No chart registers them yet (only d68_h17 is
 * wired in this task) -- the transform task lands their resolution logic.
 */
export type ChartAction = 'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Ph' | 'Rh' | 'Rs' | 'Rp' | 'Pd' | 'Ps';
