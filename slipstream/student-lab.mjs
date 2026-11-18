// Classroom reference only: this module never connects to or commands a car.
// Keep the declared dependency snapshot aligned with package.json (tested below).
const SDK_REVISION = '410352617b8660338746a6bb2b2dd173afb1b91a';
const sdk = 'https://github.com/anki/drive-sdk/blob/' + SDK_REVISION;

export const STUDENT_LAB = {
  inside: {
    title: 'Inside your car · HBOM',
    introduction: 'The car reads printed track codes and reports its position over Bluetooth. Slipstream combines those readings into a map and requests speed and lateral movement. A command or reply alone does not prove a physical maneuver finished.',
    inventoryLabel: 'Hardware capability inventory · an HBOM starting point',
    inventory: [
      {part: 'Optical sensing', evidence: 'Track codes and position reports', limit: 'Exact sensor part unverified'},
      {part: 'Radio', evidence: 'Bluetooth Low Energy commands and notifications', limit: 'Exact radio chipset unverified'},
      {part: 'Power and motion', evidence: 'Battery-voltage reports and powered wheels', limit: 'Battery and motor part numbers unverified'}
    ],
    limitation: 'These are documented or observed capabilities, not a complete hardware bill of materials. The processor, circuit-board revision and individual component markings still need model-specific evidence.',
    links: [
      {label: 'Official Anki protocol', url: sdk + '/include/ankidrive/protocol.h'},
      {label: 'Manufacturer track and sensor guide', url: 'https://support.anki.bot/article/243-the-modular-track'}
    ]
  },
  software: {
    title: 'Software supply chain · SBOM',
    introduction: 'A software bill of materials (SBOM) identifies the components in a software build. This quick inventory lists only this project’s directly declared runtime packages.',
    inventoryLabel: 'Declared dependencies · package.json snapshot',
    dependencies: [
      {name: 'express', version: '5.3.0', purpose: 'Web requests'},
      {name: 'qrcode-generator', version: '2.0.4', purpose: 'Join-code images'},
      {name: 'three', version: '0.187.0', purpose: '3D circuit rendering'},
      {name: 'ws', version: '8.22.2', purpose: 'Live browser messages'}
    ],
    limitation: 'This is not a complete SBOM: nested packages, the browser, operating system and car firmware are outside this list. A clean vulnerability scan is evidence about known advisories, not proof that a system is secure.',
    links: [
      {label: 'Project dependency manifest', url: 'https://github.com/matthewluallen/cs460-second-lap-overdrive/blob/slipstream-and-security-hardening/package.json'},
      {label: 'npm SBOM documentation', url: 'https://docs.npmjs.com/cli/v11/commands/npm-sbom'}
    ]
  },
  radio: {
    title: 'Radio identity · FCC ID',
    introduction: 'With the car switched off, transcribe its FCC ID and model number from the label. Search the exact FCC ID, then compare the applicant, model and label exhibit with your car.',
    limitation: 'No model-to-FCC-ID mapping is assumed here. A Bluetooth name, paint scheme or firmware number does not establish the label’s identity. Radio authorization is not a cybersecurity assessment.',
    links: [
      {label: 'Official FCC equipment search', url: 'https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm'},
      {label: 'Anki advertisement fields', url: sdk + '/include/ankidrive/advertisement.h'}
    ]
  },
  security: {
    title: 'Security challenge',
    introduction: 'Choose a question. Make a prediction, inspect a saved trace or simulation, and explain what evidence would change your answer.',
    challenges: [
      {title: 'Trust the right evidence', question: 'Which proves more: a matching Bluetooth name, a command reply, or an observed result? Explain what each can and cannot establish.'},
      {title: 'Reject old instructions', question: 'After STOP, could an old steering request run later? Find the evidence that stopped or stale commands cannot restart motion.'},
      {title: 'Follow the supply chain', question: 'Pick one package above. Find its dependencies and a published advisory, if any. Does that advisory affect this exact version and how we use it?'}
    ],
    links: [
      {label: 'Official SDK programming guide', url: 'https://anki.github.io/drive-sdk/docs/programming-guide'},
      {label: 'Project security policy', url: 'https://github.com/matthewluallen/cs460-second-lap-overdrive/blob/slipstream-and-security-hardening/SECURITY.md'}
    ]
  }
};

// Explicit mounting keeps the module importable by offline tests and gives the
// host control over where the optional lesson appears. No storage or listeners.
export function mountStudentLab(container) {
  if (!container) return false;
  const doc = container.ownerDocument;
  const node = (tag, text, className) => {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const sections = Object.values(STUDENT_LAB).map(section => {
    const details = node('details', undefined, 'student-lab-section');
    details.append(node('summary', section.title), node('p', section.introduction));
    if (section.inventory) {
      details.append(node('p', section.inventoryLabel, 'student-lab-label'));
      const inventory = node('dl', undefined, 'student-lab-inventory');
      for (const row of section.inventory) {
        inventory.append(node('dt', row.part), node('dd', row.evidence + '. ' + row.limit + '.'));
      }
      details.append(inventory);
    }
    if (section.dependencies) {
      const table = node('table', undefined, 'student-lab-inventory');
      table.append(node('caption', section.inventoryLabel));
      const head = node('thead'), heading = node('tr');
      for (const label of ['Package', 'Version', 'Purpose']) {
        const cell = node('th', label); cell.scope = 'col'; heading.append(cell);
      }
      head.append(heading); table.append(head);
      const body = node('tbody');
      for (const dependency of section.dependencies) {
        const row = node('tr');
        row.append(node('td', dependency.name), node('td', dependency.version), node('td', dependency.purpose));
        body.append(row);
      }
      table.append(body); details.append(table);
    }
    if (section.challenges) {
      const list = node('ol', undefined, 'student-lab-challenge');
      for (const challenge of section.challenges) {
        const item = node('li');
        item.append(node('strong', challenge.title + '. '), node('span', challenge.question));
        list.append(item);
      }
      details.append(list);
    }
    if (section.limitation) details.append(node('p', section.limitation, 'note'));
    const links = node('ul', undefined, 'student-lab-links');
    for (const source of section.links) {
      const item = node('li'), link = node('a', source.label);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      item.append(link); links.append(item);
    }
    details.append(links);
    return details;
  });
  container.replaceChildren(node('h2', 'Investigate the system'), node('p', 'A connected car is more than its controls. Open a question, gather evidence, and explain what you find.'), ...sections);
  return true;
}
