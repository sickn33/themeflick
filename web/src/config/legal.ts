export const legalConfig = {
  controllerName: import.meta.env.VITE_LEGAL_CONTROLLER_NAME?.trim() || 'Themeflick private preview',
  formspreeFormId: import.meta.env.VITE_FORMSPREE_FORM_ID?.trim() || '',
  effectiveDate: '23 July 2026',
}

export const legalLaunchReady = Boolean(legalConfig.formspreeFormId && import.meta.env.VITE_LEGAL_CONTROLLER_NAME?.trim())
