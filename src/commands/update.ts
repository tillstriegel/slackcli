import { Command } from 'commander';
import { info } from '../lib/formatter.ts';
import { UPDATES_DISABLED } from '../lib/updater.ts';

export function createUpdateCommand(): Command {
  const explain = () => { info(UPDATES_DISABLED); };
  const update = new Command('update')
    .description('Disabled in the privacy fork (offline explanation only)')
    .action(explain);
  update.command('check').description('Disabled in the privacy fork').action(explain);
  return update;
}
