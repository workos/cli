import clack from '../utils/clack.js';

export interface MenuSelection {
  command: 'install' | 'login' | 'logout' | 'install-skill';
}

/**
 * Display interactive menu for command selection.
 * Returns the selected command.
 */
export async function showMenu(): Promise<MenuSelection> {
  const command = await clack.select({
    message: 'What would you like to do?',
    options: [
      { value: 'install', label: 'Install AuthKit', hint: 'Add WorkOS authentication to your project' },
      { value: 'login', label: 'Login to WorkOS', hint: 'Authenticate with your WorkOS account' },
      { value: 'logout', label: 'Logout', hint: 'Remove stored credentials' },
      { value: 'install-skill', label: 'Install AI Skills', hint: 'Add AuthKit skills to coding agents' },
    ],
  });

  if (clack.isCancel(command)) {
    clack.cancel('Operation cancelled.');
    process.exit(0);
  }

  return { command: command as MenuSelection['command'] };
}
