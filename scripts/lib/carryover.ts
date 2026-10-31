/**
 * How far a record may move and still be the same summit: a terrain rescan
 * shifts a detected peak by at most a few DEM pixels (spec 27). Shared by
 * discovery's preservation and build:data's fold, in a module of its own so
 * neither loads the other's dependencies to read one number.
 */
export const CARRYOVER_KM = 0.12; // ~3 z12 pixels
