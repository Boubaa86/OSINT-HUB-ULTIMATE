import PDFDocument from 'pdfkit';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const csvCell = value => {
  const text = String(value ?? '');
  const safe = /^[=+@\\-\\t\\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function renderReport(format, report) {
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'markdown') {
    return [
      `# ${report.title}`,
      '',
      '## Résumé exécutif',
      report.investigation.description || 'Aucune description fournie.',
      '',
      '## Objectif',
      report.investigation.objective || 'Non précisé.',
      '',
      '## Méthodologie',
      'Analyse des sources listées dans ce dossier. Les observations sont datées ; les relations sont des pistes documentées et ne constituent pas une preuve de causalité.',
      '',
      '## Sources',
      ...report.sources.map(source => `- ${source.source_name} — ${source.source_url || 'URL non fournie'} — fiabilité : ${source.reliability} — ${new Date(source.collected_at).toISOString()}`),
      '',
      '## Entités',
      ...report.entities.map(entity => `- ${entity.entity_type}: ${entity.display_label} (${entity.canonical_value})`),
      '',
      '## Relations',
      ...report.relationships.map(relation => `- ${relation.from_label} -> ${relation.to_label}: ${relation.relation_type}; confiance ${Math.round(Number(relation.confidence || 0) * 100)}%; source : ${relation.source_name || 'non précisée'}; justification : ${relation.rationale}`),
      '',
      '## Notes',
      ...report.notes.map(note => `- [${new Date(note.created_at).toISOString()}] ${note.body}`),
      '',
      '## Limites',
      'Les sources peuvent être incomplètes ou obsolètes. La corrélation ne prouve pas une relation. Les scores et niveaux de confiance sont indicatifs.',
      '',
      `Généré le ${new Date(report.generatedAt).toISOString()}.`
    ].join('\n');
  }
  if (format === 'csv') {
    const rows = [
      ['record_type', 'type', 'label', 'value', 'source', 'confidence', 'date', 'details'],
      ...report.sources.map(source => ['source', source.source_type, source.source_name, source.source_url, source.source_name, '', source.collected_at, source.reliability]),
      ...report.entities.map(entity => ['entity', entity.entity_type, entity.display_label, entity.canonical_value, '', '', entity.created_at, JSON.stringify(entity.attributes)]),
      ...report.relationships.map(relation => ['relationship', relation.relation_type, relation.from_label, relation.to_label, relation.source_name, relation.confidence, relation.created_at, relation.rationale]),
      ...report.notes.map(note => ['note', 'note', '', '', '', '', note.created_at, note.body])
    ];
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  if (format === 'html') {
    return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#17212b}h1,h2{color:#123b55}li{margin:7px 0}.muted{color:#65798a}</style><h1>${escapeHtml(report.title)}</h1><p class="muted">Généré le ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p><h2>Résumé exécutif</h2><p>${escapeHtml(report.investigation.description || 'Aucune description fournie.')}</p><h2>Objectif</h2><p>${escapeHtml(report.investigation.objective || 'Non précisé.')}</p><h2>Méthodologie</h2><p>Analyse des sources listées dans ce dossier. Les observations sont datées ; les relations sont des pistes documentées et ne constituent pas une preuve de causalité.</p><h2>Sources</h2><ul>${report.sources.map(source => `<li><b>${escapeHtml(source.source_name)}</b> — ${escapeHtml(source.source_url || 'URL non fournie')} — fiabilité : ${escapeHtml(source.reliability)}</li>`).join('')}</ul><h2>Entités</h2><ul>${report.entities.map(entity => `<li>${escapeHtml(entity.entity_type)} : ${escapeHtml(entity.display_label)} (${escapeHtml(entity.canonical_value)})</li>`).join('')}</ul><h2>Relations</h2><ul>${report.relationships.map(relation => `<li>${escapeHtml(relation.from_label)} -> ${escapeHtml(relation.to_label)} : ${escapeHtml(relation.relation_type)} ; confiance ${Math.round(Number(relation.confidence || 0)*100)}% ; source : ${escapeHtml(relation.source_name || 'non précisée')} ; ${escapeHtml(relation.rationale)}</li>`).join('')}</ul><h2>Notes</h2><ul>${report.notes.map(note => `<li>${escapeHtml(new Date(note.created_at).toLocaleString())} — ${escapeHtml(note.body)}</li>`).join('')}</ul><h2>Limites</h2><p>Les sources peuvent être incomplètes ou obsolètes. La corrélation ne prouve pas une relation. Les scores et niveaux de confiance sont indicatifs.</p></html>`;
  }
  throw new Error('Unsupported report format');
}

export function streamPdf(response, report) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: report.title, Author: 'OSINT HUB ULTIMATE' } });
  doc.pipe(response);
  doc.fontSize(12).fillColor('#167b9e').text('OSINT HUB ULTIMATE');
  doc.moveDown(4).fillColor('#111111').fontSize(26).text(report.title, { align: 'left' });
  doc.moveDown(2).fontSize(10).fillColor('#526777').text(`Rapport confidentiel · Généré le ${new Date(report.generatedAt).toISOString()}`);
  doc.addPage();
  doc.fillColor('#111111').fontSize(20).text(report.title, { underline: true });
  doc.fillColor('#111111').moveDown().fontSize(15).text('Résumé exécutif');
  doc.fontSize(10).text(report.investigation.description || 'Aucune description fournie.');
  doc.moveDown().fontSize(15).text('Objectif');
  doc.fontSize(10).text(report.investigation.objective || 'Non précisé.');
  doc.moveDown().fontSize(15).text('Méthodologie');
  doc.fontSize(10).text('Analyse des sources listées dans ce dossier. Les observations sont datées ; les relations sont des pistes documentées et ne constituent pas une preuve de causalité.');
  doc.moveDown().fontSize(15).text('Sources');
  for (const source of report.sources) doc.fontSize(9).text(`• ${source.source_name} — ${source.source_url || 'URL non fournie'} — ${source.reliability} — ${new Date(source.collected_at).toISOString()}`);
  doc.moveDown().fontSize(15).text('Entités');
  for (const entity of report.entities) doc.fontSize(9).text(`• ${entity.entity_type}: ${entity.display_label} (${entity.canonical_value})`);
  doc.moveDown().fontSize(15).text('Relations');
  for (const relation of report.relationships) doc.fontSize(9).text(`• ${relation.from_label} -> ${relation.to_label}: ${relation.relation_type}; confiance ${Math.round(Number(relation.confidence || 0) * 100)}%; source : ${relation.source_name || 'non précisée'}; ${relation.rationale}`);
  doc.moveDown().fontSize(15).text('Notes');
  for (const note of report.notes) doc.fontSize(9).text(`• ${new Date(note.created_at).toISOString()} — ${note.body}`);
  doc.moveDown().fontSize(15).text('Limites');
  doc.fontSize(9).text('Les sources peuvent être incomplètes ou obsolètes. La corrélation ne prouve pas une relation. Les scores et niveaux de confiance sont indicatifs.');
  doc.end();
}
