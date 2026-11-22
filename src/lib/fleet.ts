import type { FleetCategory } from '../types.ts';

export const FLEET_CATEGORIES: Array<{ value: FleetCategory; label: string }> = [
  { value: 'tracteur', label: 'Tracteur routier' },
  { value: 'remorque', label: 'Remorque / Semi-remorque' },
  { value: 'frigo', label: 'Frigo (Frigorifique)' },
  { value: 'plateau', label: 'Plateau' },
  { value: 'porteur', label: 'Porteur / Fourgon' },
  { value: 'autre', label: 'Autre matériel' },
];

export function inferFleetCategory(vehicle: {
  fleet_category?: FleetCategory | null;
  vehicle_type?: string | null;
}): FleetCategory {
  if (
    vehicle.fleet_category &&
    ['tracteur', 'remorque', 'frigo', 'plateau', 'porteur', 'autre'].includes(vehicle.fleet_category)
  ) {
    return vehicle.fleet_category;
  }
  const raw = String(vehicle.vehicle_type || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (raw.includes('frigo') || raw.includes('frigorifi') || raw.includes('reefer')) return 'frigo';
  if (raw.includes('plateau') || raw.includes('flatbed')) return 'plateau';
  if (raw.includes('remorque') || raw.includes('semi') || raw.includes('bachee') || raw.includes('benne') || raw.includes('citerne')) {
    return 'remorque';
  }
  if (raw.includes('tracteur') || raw.includes('tractor')) return 'tracteur';
  if (raw.includes('porteur') || raw.includes('fourgon') || raw.includes('camion') || raw.includes('utilitaire')) {
    return 'porteur';
  }
  return 'tracteur';
}

export function isTrailerCategory(cat: FleetCategory): boolean {
  return cat === 'remorque' || cat === 'frigo' || cat === 'plateau';
}

export function isTractorLikeCategory(cat: FleetCategory): boolean {
  return !isTrailerCategory(cat);
}

export function fleetCategoryLabel(cat?: FleetCategory | null): string {
  const found = FLEET_CATEGORIES.find((c) => c.value === cat);
  return found ? found.label : 'Tracteur routier';
}

export function getTripTractorIds(trip: {
  vehicle_id?: string | null;
  tractor_ids?: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(trip.tractor_ids)) {
    for (const id of trip.tractor_ids) {
      if (typeof id === 'string' && id.trim() && !seen.has(id.trim())) {
        seen.add(id.trim());
        out.push(id.trim());
      }
    }
  }
  if (typeof trip.vehicle_id === 'string' && trip.vehicle_id.trim() && !seen.has(trip.vehicle_id.trim())) {
    if (out.length === 0) {
      out.push(trip.vehicle_id.trim());
    } else {
      out.unshift(trip.vehicle_id.trim());
    }
  }
  return out;
}
