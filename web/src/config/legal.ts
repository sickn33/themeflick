export const legalConfig = {
  controllerName: import.meta.env.VITE_LEGAL_CONTROLLER_NAME?.trim() || 'Themeflick private preview',
  contactEmail: import.meta.env.VITE_LEGAL_CONTACT_EMAIL?.trim() || '',
  effectiveDate: '23 July 2026',
}

export const legalLaunchReady = Boolean(legalConfig.contactEmail && import.meta.env.VITE_LEGAL_CONTROLLER_NAME?.trim())
