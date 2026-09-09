import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Iniciando Testes de Validação do Teclado Visual (Numpad) ===\n');

// 1. Validar src/ui/index.html
console.log('-> Teste 1: Validação dos elementos HTML do Numpad, Seção D e Layout Fullscreen');
const indexHtml = fs.readFileSync(path.join(rootDir, 'src/ui/index.html'), 'utf-8');

assert.ok(indexHtml.includes('id="vk-numpad-keypad"'), 'Deve conter #vk-numpad-keypad');
assert.ok(indexHtml.includes('class="vk-numpad-grid"'), 'Deve conter .vk-numpad-grid');
assert.ok(indexHtml.includes('id="vk-numpad-header"'), 'Deve conter #vk-numpad-header');

const expectedNumpadCodes = [
    'NumLock',
    'NumpadDivide',
    'NumpadMultiply',
    'NumpadSubtract',
    'Numpad7',
    'Numpad8',
    'Numpad9',
    'NumpadAdd',
    'Numpad4',
    'Numpad5',
    'Numpad6',
    'Numpad1',
    'Numpad2',
    'Numpad3',
    'NumpadEnter',
    'Numpad0',
    'NumpadDecimal'
];

expectedNumpadCodes.forEach(code => {
    assert.ok(
        indexHtml.includes(`data-code="${code}"`),
        `Deve conter tecla com data-code="${code}" no teclado visual`
    );
});

assert.ok(indexHtml.includes('data-layer="ctrl-alt"'), 'Deve conter botão de camada ctrl-alt');
assert.ok(indexHtml.includes('Layout / Numpad'), 'Legenda de cores deve incluir Layout / Numpad');
assert.ok(indexHtml.includes('id="vk-schematic-list-workspace"'), 'Deve conter lista #vk-schematic-list-workspace');
assert.ok(indexHtml.includes('SEÇÃO D · LAYOUT & WORKSPACE (NUMPAD)'), 'Deve conter cabeçalho da SEÇÃO D');
assert.ok(indexHtml.includes('data-category="workspace_numpad"'), 'Deve conter pílula de filtro workspace_numpad');

// Valida remoção do botão de maximizar (já é full permanente)
assert.ok(!indexHtml.includes('id="btn-maximize-help"'), 'Não deve conter botão de maximizar, pois a janela é full permanente');

// Valida proporções 1:1:1 dos blocos de teclado
assert.ok(indexHtml.includes('flex: 15'), 'Main keypad deve ter proporção flex: 15');
assert.ok(indexHtml.includes('flex: 3.2'), 'Nav keypad deve ter proporção flex: 3.2');
assert.ok(indexHtml.includes('flex: 4.2'), 'Numpad keypad deve ter proporção flex: 4.2');
assert.ok(indexHtml.includes('max-width: 1260px'), 'Teclado deve ter max-width: 1260px para evitar esticar teclas');
console.log('✓ Teste 1 passou: Todos os elementos HTML e proporções do teclado validados com sucesso.');

// 2. Validar src/ui/styles.css
console.log('\n-> Teste 2: Validação das regras CSS do Numpad e fullscreen');
const stylesCss = fs.readFileSync(path.join(rootDir, 'src/ui/styles.css'), 'utf-8');

assert.ok(stylesCss.includes('.vk-cat-workspace_numpad'), 'styles.css deve conter classe .vk-cat-workspace_numpad');
assert.ok(stylesCss.includes('.vk-numpad-grid'), 'styles.css deve conter classe .vk-numpad-grid');
assert.ok(stylesCss.includes('.vk-numpad-grid .vk-keycap'), 'styles.css deve definir altura 100% para keycaps no grid numpad');
assert.ok(stylesCss.includes('width: 100vw !important'), 'modal-fullscreen-container deve ter width: 100vw permanente');
assert.ok(stylesCss.includes('height: 100vh !important'), 'modal-fullscreen-container deve ter height: 100vh permanente');
console.log('✓ Teste 2 passou: Regras CSS do Numpad e fullscreen validadas com sucesso.');

// 3. Validar src/ui/js/panels.js
console.log('\n-> Teste 3: Validação do controlador do Teclado Visual em panels.js');
const panelsJs = fs.readFileSync(path.join(rootDir, 'src/ui/js/panels.js'), 'utf-8');

assert.ok(panelsJs.includes('vk-cat-workspace_numpad'), 'panels.js deve remover/adicionar vk-cat-workspace_numpad');
assert.ok(panelsJs.includes('ctrl-alt'), 'panels.js deve suportar camada ctrl-alt');
assert.ok(panelsJs.includes('vk-schematic-list-workspace'), 'panels.js deve popular vk-schematic-list-workspace');
assert.ok(panelsJs.includes('workspace_numpad: "fa-table-columns"'), 'panels.js deve ter ícone para categoria workspace_numpad');
assert.ok(panelsJs.includes('8. Pistas Dinâmicas (Multipista)'), 'panels.js deve manter numeração correta das seções');
console.log('✓ Teste 3 passou: Controlador em panels.js validado com sucesso.');

console.log('\n==================================================================');
console.log('TODOS OS TESTES DO TECLADO VISUAL NUMPAD PASSARAM COM SUCESSO!');
console.log('==================================================================');
