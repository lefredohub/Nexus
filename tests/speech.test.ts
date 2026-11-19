import { describe, expect, it } from 'vitest';
import { SentenceChunker, stripForSpeech } from '../src/lib/speech';

describe('voix de Jarvis', () => {
  it('rend une réponse Markdown agréable à écouter', () => {
    const md = '## Point du jour\n\n- **Newsletter** à 60 %\n- Voir [le projet](https://x.y/z) prj_Ab12Cd34\n\n`code` 🚀';
    const spoken = stripForSpeech(md);
    expect(spoken).not.toMatch(/[#*`[\]🚀]|https|prj_/);
    expect(spoken).toContain('Newsletter à 60 %');
    expect(spoken).toContain('le projet');
  });

  it('découpe le texte en phrases au fil du streaming', () => {
    const c = new SentenceChunker(10);
    expect(c.push('Bonjour Alex. Tu as ')).toEqual(['Bonjour Alex.']);
    expect(c.push('trois tâches en retard. Et ')).toEqual(['Tu as trois tâches en retard.']);
    expect(c.push('un projet')).toEqual([]);
    expect(c.flush()).toBe('Et un projet');
    expect(c.flush()).toBeNull();
  });

  it('ne coupe pas les nombres décimaux ni les phrases trop courtes', () => {
    const c = new SentenceChunker(20);
    expect(c.push('Ok. Ton solde est de 1949.50 euros ce mois-ci. ')).toEqual(['Ok. Ton solde est de 1949.50 euros ce mois-ci.']);
  });
});
