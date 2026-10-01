import { expect, it } from 'bun:test';
import { authenticateAuto } from './auth.ts';
it('rejects automatic login before browser capture', async () => {
  await expect(authenticateAuto({ headless: true, workspaceUrl: 'https://team.slack.com' })).rejects.toThrow('disabled');
});
