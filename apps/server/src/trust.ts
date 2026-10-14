import { randomBytes } from 'node:crypto';

/**
 * Per-process secret the server puts in room options it creates itself (ranked rooms from
 * the queue, rematch rooms). Clients never see it, so they can't forge a ranked room or
 * claim someone else's profile through a seat reservation.
 */
export const INTERNAL_KEY = randomBytes(16).toString('hex');
