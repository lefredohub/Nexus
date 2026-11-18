/** Capture rapide : déposer une tâche, une idée ou une note en deux secondes. */
import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Lightbulb, StickyNote } from 'lucide-react';
import { api, useAction } from '../lib/api';
import { Button, Modal, Tabs, Textarea, Kbd } from '../components/ui';

type Kind = 'task' | 'idea' | 'note';

export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('task');
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => ref.current?.focus(), 50);
    }
  }, [open]);

  const save = useAction(
    async () => {
      const t = text.trim();
      if (kind === 'task') return api('/tasks', { body: { title: t.slice(0, 200) } });
      if (kind === 'idea') return api('/ideas', { body: { content: t } });
      const [first, ...rest] = t.split('\n');
      return api('/notes', { body: { title: first.slice(0, 200), content: rest.join('\n').trim() } });
    },
    { success: kind === 'task' ? 'Tâche ajoutée' : kind === 'idea' ? 'Idée déposée dans l’Idea Engine' : 'Note enregistrée' },
  );

  const submit = () => {
    if (text.trim().length < (kind === 'idea' ? 3 : 1)) return;
    save.mutate(undefined, { onSuccess: onClose });
  };

  return (
    <Modal open={open} onClose={onClose} title="Capture rapide">
      <Tabs
        value={kind}
        onChange={setKind}
        className="mb-4"
        items={[
          { value: 'task', label: <span className="flex items-center gap-1.5"><CheckSquare size={13} /> Tâche</span> },
          { value: 'idea', label: <span className="flex items-center gap-1.5"><Lightbulb size={13} /> Idée</span> },
          { value: 'note', label: <span className="flex items-center gap-1.5"><StickyNote size={13} /> Note</span> },
        ]}
      />
      <Textarea
        ref={ref}
        rows={kind === 'task' ? 2 : 5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (kind === 'task' && !e.shiftKey))) (e.preventDefault(), submit());
        }}
        placeholder={kind === 'task' ? 'Ce qu’il faut faire…' : kind === 'idea' ? 'Dépose ton idée telle qu’elle vient, sans la structurer. L’IA s’en chargera.' : 'Titre sur la première ligne, puis le contenu…'}
      />
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-ink-3">
          <Kbd>{kind === 'task' ? '↵' : '⌘↵'}</Kbd> pour enregistrer
        </span>
        <Button variant="primary" onClick={submit} loading={save.isPending}>
          Enregistrer
        </Button>
      </div>
    </Modal>
  );
}
