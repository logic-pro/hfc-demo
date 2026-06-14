// Mock GET /api/dashboard payload — lets the whole UI build & demo before the
// backend read-model lands. Shaped EXACTLY like DashboardResponse so swapping to
// the live endpoint is a one-line change in DashboardApiService.
//
// The numbers tell a deliberate story: solid demand, but a visible deposit leak
// (Reminded → DepositPaid drop + 6 Expired) so the funnel and action table have
// something real to point at.

import { DashboardResponse, DashboardFilters } from './dashboard.models';

export function mockDashboard(filters: DashboardFilters): DashboardResponse {
  const focus = filters.territoryId;
  return {
    period: {
      type: filters.period,
      label:
        filters.period === 'WTD' ? 'This week'
        : filters.period === 'MTD' ? 'This month'
        : filters.period === 'QTD' ? 'This quarter'
        : 'This year',
      start: '2026-06-01T00:00:00Z',
      end: '2026-06-12T23:59:59Z',
    },
    lastUpdated: '2026-06-12T13:05:00Z',
    territory: focus ? { id: focus, name: territoryName(focus) } : null,

    kpis: [
      { key: 'bookings', label: 'Bookings', value: 128, unit: 'count',
        deltaPercent: 0.114, trend: [14, 18, 16, 22, 19, 21, 18], status: 'good',
        dataQuality: 'measured', higherIsBetter: true, drillTo: 'all',
        tooltip: 'Appointments booked in the selected period.' },
      { key: 'slot_fill_rate', label: 'Slot fill rate', value: 0.78, unit: 'percent',
        deltaPercent: 0.04, trend: [0.70, 0.72, 0.69, 0.74, 0.76, 0.77, 0.78], status: 'good',
        dataQuality: 'measured', higherIsBetter: true, drillTo: 'open_slots',
        tooltip: 'Filled slots ÷ available slots. Low fill = unused crew capacity.' },
      { key: 'deposit_conversion', label: 'Deposit conversion', value: 0.61, unit: 'percent',
        deltaPercent: -0.07, trend: [0.70, 0.68, 0.66, 0.64, 0.63, 0.62, 0.61], status: 'warning',
        dataQuality: 'measured', higherIsBetter: true, drillTo: 'deposit_unpaid',
        tooltip: 'Booked appointments that paid a deposit. Falling = revenue at risk.' },
      { key: 'deposit_volume', label: 'Deposit volume', value: 392000, unit: 'currency_cents',
        deltaPercent: 0.052, trend: [52000, 58000, 55000, 61000, 60000, 53000, 53000], status: 'neutral',
        dataQuality: 'measured', higherIsBetter: true, drillTo: 'deposit_paid',
        tooltip: 'Total DEPOSITS captured — not job revenue. Job revenue is not in the system.' },
      { key: 'expired_abandoned', label: 'Expired / abandoned', value: 6, unit: 'count',
        deltaPercent: 0.20, trend: [2, 3, 3, 4, 5, 5, 6], status: 'bad',
        dataQuality: 'measured', higherIsBetter: false, drillTo: 'expired',
        tooltip: 'Bookings that expired without a deposit (the workflow leak).' },
    ],

    bookingTrend: [
      { date: '2026-06-06', bookings: 14, filledSlots: 11, openSlots: 5 },
      { date: '2026-06-07', bookings: 18, filledSlots: 14, openSlots: 4 },
      { date: '2026-06-08', bookings: 16, filledSlots: 12, openSlots: 6 },
      { date: '2026-06-09', bookings: 22, filledSlots: 18, openSlots: 3 },
      { date: '2026-06-10', bookings: 19, filledSlots: 15, openSlots: 5 },
      { date: '2026-06-11', bookings: 21, filledSlots: 17, openSlots: 4 },
      { date: '2026-06-12', bookings: 18, filledSlots: 14, openSlots: 4 },
    ],

    // Booked → Reminded → DepositPaid → Finalized ; Expired branches off as leak.
    depositFunnel: [
      { stage: 'Booked', count: 128, conversionFromPrev: null, isLeak: false, drillTo: 'all' },
      { stage: 'Reminded', count: 119, conversionFromPrev: 0.93, isLeak: false, drillTo: 'all' },
      { stage: 'DepositPaid', count: 78, conversionFromPrev: 0.655, isLeak: false, drillTo: 'deposit_paid' },
      { stage: 'Finalized', count: 72, conversionFromPrev: 0.923, isLeak: false, drillTo: 'deposit_paid' },
      { stage: 'Expired', count: 6, conversionFromPrev: null, isLeak: true, drillTo: 'expired' },
    ],

    territoryBreakdown: focus ? [territoryRow(focus)] : [
      { territoryId: 1, territoryName: 'Orange County North', bookings: 52, fillRate: 0.84, depositConversion: 0.67, needsActionCount: 4 },
      { territoryId: 2, territoryName: 'Inland Empire', bookings: 41, fillRate: 0.74, depositConversion: 0.58, needsActionCount: 7 },
      { territoryId: 3, territoryName: 'San Diego Coast', bookings: 35, fillRate: 0.71, depositConversion: 0.55, needsActionCount: 5 },
    ],

    actionRows: [
      { appointmentId: 5012, customerName: 'Maria Gomez', territoryId: 2, territoryName: 'Inland Empire',
        startUtc: '2026-06-13T17:00:00Z', service: 'In-home consult', depositCents: 0, depositPaid: false,
        stage: 'Reminded', recommendedAction: 'Send deposit link — reminded but unpaid for 2 days', severity: 'bad' },
      { appointmentId: 5006, customerName: 'Derek Liu', territoryId: 1, territoryName: 'Orange County North',
        startUtc: '2026-06-12T22:30:00Z', service: 'Window estimate', depositCents: 0, depositPaid: false,
        stage: 'Expired', recommendedAction: 'Re-offer slot — booking expired without deposit', severity: 'bad' },
      { appointmentId: 5021, customerName: 'Aisha Khan', territoryId: 3, territoryName: 'San Diego Coast',
        startUtc: '2026-06-14T19:00:00Z', service: 'In-home consult', depositCents: 0, depositPaid: false,
        stage: 'Reminded', recommendedAction: 'Call to confirm — high-value slot still unpaid', severity: 'warning' },
      { appointmentId: 5029, customerName: 'Tom Becker', territoryId: 2, territoryName: 'Inland Empire',
        startUtc: '2026-06-15T16:00:00Z', service: 'Closet design', depositCents: 5000, depositPaid: true,
        stage: 'DepositPaid', recommendedAction: 'Confirm crew assignment for finalization', severity: 'neutral' },
    ],

    revenue: {
      available: false,
      reason: 'Job revenue is not captured in this system. Showing deposit volume only.',
    },
  };
}

function territoryName(id: number): string {
  return { 1: 'Orange County North', 2: 'Inland Empire', 3: 'San Diego Coast' }[id] ?? `Territory ${id}`;
}

function territoryRow(id: number) {
  return { territoryId: id, territoryName: territoryName(id), bookings: 41, fillRate: 0.74, depositConversion: 0.58, needsActionCount: 7 };
}
