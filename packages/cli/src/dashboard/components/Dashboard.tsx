import React from 'react';
import { DashboardLayout } from './DashboardLayout.js';
import type { DashboardProps } from '../types.js';

export function Dashboard({ emitter }: DashboardProps): React.ReactElement {
  return <DashboardLayout emitter={emitter} />;
}
