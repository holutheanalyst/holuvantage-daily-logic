// Single serverless entry point. vercel.json rewrites /api/* here (keeps us within function limits).
import { HttpError, send } from '../lib/server.js';
import * as game from '../lib/game.js';
import * as billing from '../lib/billing.js';
import * as admin from '../lib/admin.js';

const routes = {
  'GET config': game.getConfig,
  'POST guest': game.createGuest,
  'GET me': game.getMe,
  'PATCH me': game.updateMe,
  'POST attempt/start': game.startAttempt,
  'POST attempt/hint': game.useHint,
  'POST attempt/submit': game.submitAttempt,
  'GET leaderboard': game.getLeaderboard,
  'GET stats': game.getStats,
  'POST groups': game.createGroup,
  'POST groups/join': game.joinGroup,
  'POST groups/leave': game.leaveGroup,
  'POST account/claim': game.claimGuest,
  'GET account/export': game.exportData,
  'DELETE account': game.deleteAccount,
  'POST event': game.trackEvent,
  'POST report': game.createReport,
  'POST billing/checkout': billing.checkout,
  'POST billing/manage': billing.manage,
  'POST webhooks/stripe': billing.stripeWebhook,
  'POST webhooks/paystack': billing.paystackWebhook,
  'POST webhooks/razorpay': billing.razorpayWebhook,
  'GET admin/metrics': admin.metrics,
  'GET admin/puzzles': admin.listPuzzles,
  'POST admin/puzzles/generate': admin.generateFuture,
  'POST admin/puzzles/validate': admin.validate,
  'POST admin/puzzles/disable': admin.disable,
  'POST admin/puzzles/replace': admin.replace,
  'GET admin/reports': admin.listReports,
  'PATCH admin/reports': admin.updateReport,
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const query = Object.fromEntries(url.searchParams);
  const path = (query.route || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  delete query.route;
  const fn = routes[`${req.method} ${path}`];
  try {
    if (!fn) throw new HttpError(404, 'Not found');
    send(res, 200, await fn(req, query));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error('Unhandled', req.method, path, e);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}
