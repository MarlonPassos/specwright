/** Fragments reused across workflow bodies so every command states them identically. */

export const CLI_NOTE = [
  'Todos os comandos abaixo são da CLI `specs`. Rode de qualquer lugar dentro do projeto:',
  'a CLI encontra o workspace subindo a partir do diretório de trabalho.',
  '',
  'Todo comando que imprime JSON o faz no stdout como um único documento. Faça o parse -',
  'nunca deduza um caminho, um estado ou um id de artefato da saída legível.',
].join('\n');

export const RESOLVE_CHANGE = [
  '**Resolvendo a change**',
  '',
  'Se o usuário nomeou uma change, use ela. Caso contrário rode `specs list --json` e:',
  '- exatamente uma change ativa: use ela, e diga qual escolheu;',
  '- várias: pergunte ao usuário qual delas;',
  '- nenhuma: diga isso e pare.',
].join('\n');

export const PLANNING_BOUNDARY = [
  '**Limite de planejamento**: este comando produz apenas artefatos de planejamento. O pedido',
  'que o disparou autoriza planejar, mesmo quando vem escrito como "implemente" ou "corrija".',
  'Não edite o código do projeto e não comece a implementar. Quando os artefatos estiverem',
  'prontos, pare e espere um novo pedido.',
].join('\n');

export const ARTIFACT_RULES = [
  '**Escrevendo um artefato**',
  '',
  '1. Peça as instruções dele à CLI:',
  '   ```bash',
  '   specs instructions <id-do-artefato> --change "<change>" --json',
  '   ```',
  '2. A resposta carrega:',
  '   - `instruction` - a orientação definitiva para este tipo de artefato;',
  '   - `template` - a estrutura a preencher;',
  '   - `context` e `rules` - restrições para VOCÊ. Nunca copie para dentro do arquivo;',
  '   - `outputPath` - onde o artefato vai. Quando `outputIsPattern` é true, o caminho é um',
  '     padrão e `instruction` diz como escolher os nomes concretos dos arquivos;',
  '   - `dependencies` - artefatos a ler antes, com os arquivos que os contêm;',
  '   - `skipped` e `warning` - presentes quando a change abriu mão deste artefato.',
  '     Não o crie; escolha outro.',
  '3. Leia cada arquivo de dependência do disco antes de escrever, mesmo que já o tenha visto -',
  '   o usuário pode tê-lo editado desde então.',
  '4. Escreva o arquivo em `outputPath` seguindo `template` e `instruction`.',
  '5. Confirme que o arquivo existe antes de seguir em frente.',
].join('\n');
