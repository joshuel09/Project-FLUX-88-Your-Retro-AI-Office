import { ApprovalInbox } from '../../../../components/approvals/approval-inbox';

export const metadata = { title: 'Approval Inbox — FLUX-88' };

export default function ApprovalInboxPage() {
  return (
    <section aria-labelledby="approval-inbox-title" className="flex flex-col gap-5">
      <header>
        <h1 id="approval-inbox-title" className="neon-glow text-2xl font-bold text-amber-warm">Approval Inbox</h1>
        <p className="mt-1 text-sm text-cyan-soft">Review proposed actions. Your decision is recorded with the request and requires your password.</p>
      </header>
      <ApprovalInbox />
    </section>
  );
}
