// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// Email via Resend SDK (https://resend.com). Set RESEND_API_KEY in .env.

import { Resend } from 'resend';
import { log, tags } from '#utils/logging';

export async function sendEmail({ to, subject, html, from }) {
    if (!process.env.RESEND_API_KEY) {
        log(tags.warning, `Email not sent (no RESEND_API_KEY): ${subject} → ${to}`);
        return;
    }
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { error } = await resend.emails.send({
            from: from || process.env.RESEND_FROM || 'NexusGuild <noreply@nexusguild.gg>',
            to,
            subject,
            html,
        });
        if (error) {
            log(tags.error, 'Resend error:', error);
        } else {
            log(tags.info, `Email sent: ${subject} → ${to}`);
        }
    } catch (err) {
        log(tags.error, 'Failed to send email:', err);
    }
}
