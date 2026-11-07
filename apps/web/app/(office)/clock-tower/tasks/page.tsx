import { TaskBoard } from '../../../../components/tasks/task-board';

export const metadata = { title: 'Task Board — FLUX-88' };

export default function TaskBoardPage() {
  return (
    <section aria-labelledby="board-title">
      <h1 id="board-title" className="neon-glow text-2xl font-bold text-amber-warm">
        Task Board
      </h1>
      <p className="mb-6 mt-1 text-sm text-cyan-soft">
        Delegate a goal and DOC decomposes it into specialist subtasks. Every status change is
        audited; blocked tasks surface their reason and wait for you.
      </p>
      <TaskBoard />
    </section>
  );
}
