export const rules = [
  {
    bit: 1,
    title: '발행자 확인',
    description: '등록된 금고가 발행한 영수증만 허용합니다.',
    code: 'emitter == trustedVault',
  },
  {
    bit: 2,
    title: '중복 지급 방지',
    description: '같은 라운드에서 사용한 영수증은 다시 지급하지 않습니다.',
    code: '!used[receiptId]',
  },
  {
    bit: 4,
    title: '전체 로그 탐색',
    description: '첫 로그에서 멈추지 않고 올바른 이벤트를 찾습니다.',
    code: 'findMatchingLog(receipt)',
  },
];

export const levels = [
  {
    id: 1,
    number: '01',
    title: '같은 모양, 다른 발행자',
    subtitle: 'THE COUNTERFEIT',
    difficulty: '입문',
    baseline: 0,
    normal: 'normal',
    attack: 'forged',
    story:
      '이벤트 이름도 금액도 같습니다. 공격자는 다른 계약에서 똑같은 영수증을 만들었습니다. 금고는 누구의 말을 믿어야 할까요?',
    hint: '증명은 이 이벤트가 발생했다는 사실을 보장합니다. 누가 발행했는지는 지급 규칙이 확인해야 합니다.',
    lesson: '포함 증명은 이벤트의 존재를 입증합니다. 허용된 발행자인지는 애플리케이션의 책임입니다.',
  },
  {
    id: 2,
    number: '02',
    title: '한 장으로 두 번',
    subtitle: 'THE SECOND CLAIM',
    difficulty: '기본',
    baseline: 0,
    normal: 'normal',
    attack: 'normal',
    story:
      '정당한 영수증으로 이미 50점을 받았습니다. 공격자가 같은 영수증을 다시 내밉니다. 두 번째 요청도 정당할까요?',
    hint: '내용도 발행자도 맞습니다. 이전에 처리했는지 기억하는 규칙이 필요합니다.',
    lesson:
      '진짜 영수증도 중복 지급의 근거가 될 수 있습니다. 증거 보존과 업무 처리의 중복 방지를 구분하세요.',
  },
  {
    id: 3,
    number: '03',
    title: '첫 줄의 함정',
    subtitle: 'THE DECOY LOG',
    difficulty: '응용',
    baseline: 1,
    normal: 'mixed',
    attack: 'forged',
    story:
      '발행자를 확인했더니 공격은 막혔습니다. 그런데 정상 고객도 지급을 받지 못합니다. 영수증의 첫 로그 뒤에는 무엇이 있을까요?',
    hint: '공격을 막는 것만으로는 부족합니다. 같은 거래의 다른 로그에 정상 이벤트가 숨어 있습니다.',
    lesson:
      '안전한 검증은 공격을 거부하면서 정상 요청을 처리합니다. 첫 번째 로그만 검사하면 정상 이벤트를 놓칠 수 있습니다.',
  },
];
