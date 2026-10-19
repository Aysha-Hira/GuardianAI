import type { AlertStatus } from '../types'

export interface AlertAction {
  status: AlertStatus
  label: string
  description?: string
  variant?: 'primary' | 'danger' | 'ghost'
  confirm?: {
    title: string
    message: string
    confirmLabel: string
  }
}

const ACTIONS: Partial<Record<AlertStatus, AlertAction[]>> = {
  new: [
    {
      status: 'acknowledged',
      label: 'Acknowledge',
      description: 'Mark as seen and under operator review',
      variant: 'primary',
    },
    { status: 'under_review', label: 'Under Review', variant: 'ghost' },
    {
      status: 'escalated',
      label: 'Escalate',
      description: 'Notify security lead and priority queue',
      variant: 'danger',
      confirm: {
        title: 'Escalate incident',
        message:
          'This will flag the incident for senior review and add it to the priority queue. Continue?',
        confirmLabel: 'Escalate now',
      },
    },
    {
      status: 'false_alarm',
      label: 'False Alarm',
      variant: 'ghost',
      confirm: {
        title: 'Mark as false alarm',
        message: 'This incident will be closed as a false positive. Continue?',
        confirmLabel: 'Confirm false alarm',
      },
    },
    { status: 'resolved', label: 'Resolve', variant: 'ghost' },
  ],
  acknowledged: [
    {
      status: 'under_review',
      label: 'Under Review',
      description: 'Move to active investigation',
      variant: 'primary',
    },
    {
      status: 'escalated',
      label: 'Escalate',
      description: 'Notify security lead and priority queue',
      variant: 'danger',
      confirm: {
        title: 'Escalate incident',
        message:
          'This will flag the incident for senior review and add it to the priority queue. Continue?',
        confirmLabel: 'Escalate now',
      },
    },
    {
      status: 'false_alarm',
      label: 'False Alarm',
      variant: 'ghost',
      confirm: {
        title: 'Mark as false alarm',
        message: 'This incident will be closed as a false positive. Continue?',
        confirmLabel: 'Confirm false alarm',
      },
    },
    { status: 'resolved', label: 'Resolve', variant: 'ghost' },
  ],
  under_review: [
    {
      status: 'escalated',
      label: 'Escalate',
      description: 'Requires immediate senior attention',
      variant: 'primary',
      confirm: {
        title: 'Escalate incident',
        message:
          'Escalation will notify the security lead and bump this to the priority queue. Continue?',
        confirmLabel: 'Escalate now',
      },
    },
    {
      status: 'resolved',
      label: 'Resolve',
      description: 'Close after review',
      variant: 'ghost',
    },
    {
      status: 'false_alarm',
      label: 'False Alarm',
      variant: 'ghost',
      confirm: {
        title: 'Mark as false alarm',
        message: 'This incident will be closed as a false positive. Continue?',
        confirmLabel: 'Confirm false alarm',
      },
    },
  ],
  escalated: [
    {
      status: 'resolved',
      label: 'Resolve',
      description: 'Close after escalation handled',
      variant: 'primary',
    },
    {
      status: 'false_alarm',
      label: 'False Alarm',
      variant: 'ghost',
      confirm: {
        title: 'Mark as false alarm',
        message: 'This incident will be closed as a false positive. Continue?',
        confirmLabel: 'Confirm false alarm',
      },
    },
  ],
  false_alarm: [],
  resolved: [],
}

export function getAlertActions(status: AlertStatus): AlertAction[] {
  return ACTIONS[status] ?? []
}
