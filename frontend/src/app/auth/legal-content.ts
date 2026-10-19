import type { LegalDoc } from './legal-document'

export const TERMS: LegalDoc = {
  kind: 'terms',
  contact: { label: 'Questions about these terms?', email: 'legal@guardian-ai.example' },
  title: 'Terms & Conditions',
  updated: '8 September 2026',
  intro: 'These terms govern your use of Guardian AI security monitoring software and related services.',
  sections: [
    {
      title: '1. Acceptance of terms',
      paragraphs: [
        'By accessing or using Guardian AI (“the Service”), you agree to be bound by these Terms & Conditions. If you do not agree, do not create an account or use the platform.',
        'These terms apply to operators, administrators, and any authorized users of your organization’s workspace.',
      ],
    },
    {
      title: '2. Service description',
      paragraphs: [
        'Guardian AI provides AI-assisted CCTV monitoring, incident detection, alerting, reporting, and related security operations tools. Features may vary by subscription plan and deployment configuration.',
        'Development environments may return verification codes in API responses when SMTP is not configured. Production deployments should use verified email delivery and separate enterprise agreements where required.',
      ],
    },
    {
      title: '3. Accounts & security',
      paragraphs: [
        'You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us immediately of any unauthorized access.',
        'You must provide accurate registration information and keep it up to date. We may suspend accounts that violate these terms or pose a security risk.',
      ],
    },
    {
      title: '4. Acceptable use',
      paragraphs: [
        'You may use the Service only for lawful security monitoring and operations aligned with applicable privacy, employment, and surveillance regulations in your jurisdiction.',
        'You may not reverse engineer, abuse, overload, or attempt to bypass access controls; upload malicious content; or use the Service to harass individuals or conduct unlawful surveillance.',
      ],
    },
    {
      title: '5. Subscriptions & billing',
      paragraphs: [
        'Paid plans are billed in UAE Dirhams (AED) according to the pricing shown at checkout. VAT may apply where required by law.',
        'Subscriptions renew automatically unless cancelled before the renewal date. Refunds are handled according to your plan and applicable consumer protection rules.',
      ],
    },
    {
      title: '6. Data & intellectual property',
      paragraphs: [
        'You retain ownership of your video feeds, incident data, and uploaded content. You grant Guardian AI a limited license to process that data solely to provide and improve the Service.',
        'Guardian AI software, branding, models, and documentation remain our intellectual property. No rights are granted except as expressly stated here.',
      ],
    },
    {
      title: '7. Disclaimers & liability',
      paragraphs: [
        'The Service uses automated detection and is provided “as is.” AI outputs may produce false positives or miss events. Human review remains your responsibility for critical security decisions.',
        'To the maximum extent permitted by law, Guardian AI is not liable for indirect, incidental, or consequential damages arising from use of the Service.',
      ],
    },
    {
      title: '8. Changes & contact',
      paragraphs: [
        'We may update these terms from time to time. Material changes will be communicated via the platform or email where appropriate. Continued use after changes constitutes acceptance.',
        'Questions about these terms can be sent to legal@guardian-ai.example.',
      ],
    },
  ],
}

export const PRIVACY: LegalDoc = {
  kind: 'privacy',
  contact: { label: 'Privacy questions or requests?', email: 'privacy@guardian-ai.example' },
  title: 'Privacy Policy',
  updated: '18 October 2026',
  intro: 'How Guardian AI handles personal and operational data across signup, login, and monitoring workflows.',
  sections: [
    {
      title: '1. Overview',
      paragraphs: [
        'Guardian AI (“we”, “us”) respects your privacy. This Privacy Policy explains how we collect, use, store, and protect information when you use our security monitoring platform.',
        'This policy applies to account registration, dashboard usage, incident data, and subscription checkout flows.',
      ],
    },
    {
      title: '2. Information we collect',
      paragraphs: [
        'Account data: name, email address, organization details, authentication credentials (passwords are stored only as salted bcrypt hashes), and session preferences such as “remember me”.',
        'Operational data: CCTV metadata, detection events, incident records, snapshots, clips, watchlist entries, audit logs, and configuration settings you provide.',
        'Technical data: device type, browser, IP address, timestamps, and diagnostic logs used for security and performance.',
      ],
    },
    {
      title: '3. How we use information',
      paragraphs: [
        'We use your information to authenticate users, deliver monitoring and alerting features, generate reports, process subscriptions, and maintain platform security.',
        'We may use aggregated, de-identified analytics to improve detection quality and product performance. We do not sell personal data.',
      ],
    },
    {
      title: '4. Video & biometric data',
      paragraphs: [
        'Video streams and derived imagery are processed to detect persons, vehicles, zones, and optional face-recognition watchlist matches according to your enabled features and plan.',
        'You are the data controller for footage captured on your premises. Guardian AI acts as a processor when handling that data on your behalf under your instructions and applicable law.',
      ],
    },
    {
      title: '5. Storage & retention',
      paragraphs: [
        'Retention periods depend on your plan, settings, and deployment. Incident history, snapshots, and exports may be retained for operational and compliance purposes unless you delete them or request removal where applicable.',
        'Demo environments may store data locally in your browser or on a development server with limited safeguards — do not use production-sensitive footage in demo mode.',
      ],
    },
    {
      title: '6. Sharing & subprocessors',
      paragraphs: [
        'We do not share personal data with third parties except: (a) service providers who assist with hosting, email, payments, or support under contract; (b) when required by law; or (c) with your consent.',
        'Payment processing on this demo uses simulated checkout. Production billing will be handled by certified payment partners.',
      ],
    },
    {
      title: '7. Security',
      paragraphs: [
        'We implement administrative, technical, and organizational measures including encrypted transport, access controls, and audit logging. Sessions use HttpOnly cookies with CSRF protection, and watchlist face photos and face embeddings are encrypted at rest.',
        'No system is completely secure. Report security concerns to security@guardian-ai.example.',
      ],
    },
    {
      title: '8. Your rights',
      paragraphs: [
        'Depending on your jurisdiction (including UAE PDPL where applicable), you may have rights to access, correct, delete, or restrict processing of your personal data, and to withdraw consent where processing is consent-based.',
        'Contact privacy@guardian-ai.example to exercise these rights. We will respond within applicable legal timeframes.',
      ],
    },
    {
      title: '9. Updates',
      paragraphs: [
        'We may revise this Privacy Policy periodically. The “Last updated” date at the top reflects the latest version. Significant changes will be highlighted on login or via email where appropriate.',
      ],
    },
  ],
}
