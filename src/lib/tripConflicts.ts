import type { Trip, TripStatus } from '../types.ts';
import { getTripTractorIds } from './fleet.ts';

export interface TripConflictTarget {
  id?: string | null;
  vehicle_id?: string | null;
  tractor_ids?: string[] | null;
  trailer_id?: string | null;
  driver_id?: string | null;
  departure_date?: string | null;
  arrival_date?: string | null;
  status: TripStatus;
}

export interface TripConflictDetail {
  resource: 'vehicle' | 'driver';
  reason: 'both_in_progress' | 'date_overlap';
  conflictingTrip: Trip;
  label: string;
}

export interface TripConflictResult {
  hasConflict: boolean;
  vehicleConflict: TripConflictDetail | null;
  trailerConflict?: TripConflictDetail | null;
  driverConflict: TripConflictDetail | null;
  message: string | null;
}

const OCCUPYING_STATUSES = new Set<TripStatus>(['À planifier', 'En cours']);

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getEffectiveRange(
  depDate: string | null | undefined,
  arrDate: string | null | undefined,
  status: TripStatus,
  todayIso: string,
): { start: string; end: string } | null {
  const start = depDate || arrDate || null;
  let end = arrDate || depDate || null;
  if (!start || !end) return null;
  if (status === 'En cours' && end < todayIso) {
    end = todayIso;
  }
  return start <= end ? { start, end } : { start: end, end: start };
}

function rangesOverlap(
  a: { start: string; end: string } | null,
  b: { start: string; end: string } | null,
): boolean {
  if (!a || !b) return false;
  return a.start <= b.end && a.end >= b.start;
}

function formatTripPeriod(trip: Trip): string {
  if (trip.departure_date && trip.arrival_date) {
    return trip.departure_date === trip.arrival_date
      ? `le ${trip.departure_date}`
      : `du ${trip.departure_date} au ${trip.arrival_date}`;
  }
  if (trip.departure_date) return `à partir du ${trip.departure_date}`;
  if (trip.arrival_date) return `jusqu'au ${trip.arrival_date}`;
  return 'dates non précisées';
}

function describeConflict(
  resourceLabel: string,
  reason: 'both_in_progress' | 'date_overlap',
  other: Trip,
): string {
  const route = `${other.departure} → ${other.destination}`;
  const period = formatTripPeriod(other);
  if (reason === 'both_in_progress') {
    return `${resourceLabel} est déjà « En cours » sur la mission ${other.reference} (${route}, ${period})`;
  }
  return `${resourceLabel} est déjà affecté(e) à la mission ${other.reference} (${other.status}, ${route}, ${period})`;
}

export function findTripAssignmentConflict(
  trips: Trip[],
  candidate: TripConflictTarget,
  lookups?: {
    vehicles?: Array<{ id: string; registration: string }>;
    drivers?: Array<{ id: string; full_name: string }>;
  },
  todayIso: string = getTodayIso(),
): TripConflictResult {
  if (!OCCUPYING_STATUSES.has(candidate.status)) {
    return {
      hasConflict: false,
      vehicleConflict: null,
      trailerConflict: null,
      driverConflict: null,
      message: null,
    };
  }

  const candidateRange = getEffectiveRange(
    candidate.departure_date,
    candidate.arrival_date,
    candidate.status,
    todayIso,
  );
  const candidateTractors = getTripTractorIds(candidate);
  const candidateTrailer = candidate.trailer_id || null;

  let vehicleConflict: TripConflictDetail | null = null;
  let trailerConflict: TripConflictDetail | null = null;
  let driverConflict: TripConflictDetail | null = null;

  for (const other of trips) {
    if (candidate.id && other.id === candidate.id) continue;
    if (!OCCUPYING_STATUSES.has(other.status)) continue;

    const otherRange = getEffectiveRange(
      other.departure_date,
      other.arrival_date,
      other.status,
      todayIso,
    );

    const bothInProgress =
      candidate.status === 'En cours' && other.status === 'En cours';
    const overlap = rangesOverlap(candidateRange, otherRange);

    if (!bothInProgress && !overlap) continue;
    const reason: 'both_in_progress' | 'date_overlap' = bothInProgress
      ? 'both_in_progress'
      : 'date_overlap';

    if (!vehicleConflict && candidateTractors.length > 0) {
      const otherTractors = new Set([
        ...getTripTractorIds(other),
        ...(other.trailer_id ? [other.trailer_id] : []),
      ]);
      const sharedTractorId = candidateTractors.find((id) => otherTractors.has(id));
      if (sharedTractorId) {
        const veh = lookups?.vehicles?.find((v) => v.id === sharedTractorId);
        const vehLabel = veh ? `Le véhicule / tracteur ${veh.registration}` : 'Ce tracteur';
        vehicleConflict = {
          resource: 'vehicle',
          reason,
          conflictingTrip: other,
          label: describeConflict(vehLabel, reason, other),
        };
      }
    }

    if (!trailerConflict && candidateTrailer) {
      const otherUnits = new Set([
        ...getTripTractorIds(other),
        ...(other.trailer_id ? [other.trailer_id] : []),
      ]);
      if (otherUnits.has(candidateTrailer)) {
        const trl = lookups?.vehicles?.find((v) => v.id === candidateTrailer);
        const trlLabel = trl ? `La remorque / frigo / plateau ${trl.registration}` : 'Cette remorque';
        trailerConflict = {
          resource: 'vehicle',
          reason,
          conflictingTrip: other,
          label: describeConflict(trlLabel, reason, other),
        };
      }
    }

    if (
      !driverConflict &&
      candidate.driver_id &&
      other.driver_id &&
      candidate.driver_id === other.driver_id
    ) {
      const drv = lookups?.drivers?.find((d) => d.id === candidate.driver_id);
      const drvLabel = drv ? `Le conducteur ${drv.full_name}` : 'Ce conducteur';
      driverConflict = {
        resource: 'driver',
        reason,
        conflictingTrip: other,
        label: describeConflict(drvLabel, reason, other),
      };
    }

    if (vehicleConflict && trailerConflict && driverConflict) break;
  }

  const combinedVehicleConflict = vehicleConflict || trailerConflict;

  if (!combinedVehicleConflict && !driverConflict) {
    return {
      hasConflict: false,
      vehicleConflict: null,
      trailerConflict: null,
      driverConflict: null,
      message: null,
    };
  }

  const parts: string[] = [];
  if (vehicleConflict) parts.push(vehicleConflict.label);
  if (trailerConflict) parts.push(trailerConflict.label);
  if (driverConflict) parts.push(driverConflict.label);

  const message =
    `Conflit d’attribution : ${parts.join(' ; ')}. ` +
    'Deux missions actives ne peuvent pas chevaucher un même tracteur, remorque ou conducteur sur les mêmes dates (même pour une destination différente).';

  return {
    hasConflict: true,
    vehicleConflict: combinedVehicleConflict,
    trailerConflict,
    driverConflict,
    message,
  };
}
