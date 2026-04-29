// Les helpers ringCapacity/ringRadius/slotAngle sont dans @bladeio/shared.
// Ce fichier ne garde que les utilitaires propres au serveur.
export { ringCapacity, ringRadius, ringAngularVelocity, slotAngle } from "@bladeio/shared";
import { ringCapacity } from "@bladeio/shared";

// Attribue (ringIndex, slotIndex) au slotGlobal-ième slot.
export function assignSlot(globalSlot: number): { ring: number; slot: number } {
  let ring = 0;
  let remaining = globalSlot;
  while (remaining >= ringCapacity(ring)) {
    remaining -= ringCapacity(ring);
    ring++;
  }
  return { ring, slot: remaining };
}
