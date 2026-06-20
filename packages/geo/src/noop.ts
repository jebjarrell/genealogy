import type { Place, PlaceResolver, ResolvedPlace } from '@genealogy/core';

/**
 * A resolver that never resolves anything. This is what the Step One web app
 * injects (TRD §8.3): place resolution is optional and off by default, so the
 * app wires in a NoOp to satisfy the {@link PlaceResolver} contract without
 * touching the network.
 */
export class NoOpResolver implements PlaceResolver {
  async resolve(_place: Place): Promise<ResolvedPlace | null> {
    return null;
  }
}
