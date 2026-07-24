type BuildGameSetupPromptInput = {
  count: number;
  recentWords: string[];
  topic: {
    name: string;
    description: string;
    examples: string[];
  };
  difficulty: {
    level: number;
    name: string;
    wordRule: string;
    clueRule: string;
    clueLengthRule: string;
  };
};

type BuildJudgementPromptInput = {
  word: string;
  aiNames: string[];
  aiDescriptions: {
    playerName: string;
    text: string;
  }[];
  selectedIntel?: {
    type: string;
    title: string;
    text: string;
  };
  persona?: string;
  playerGuess: string;
  playerSpeech: string;
  followupQuestion?: string;
  followupAnswer?: string;
};

type BuildFollowupPromptInput = {
  word: string;
  aiDescriptions: {
    playerName: string;
    text: string;
  }[];
  selectedIntel?: {
    type: string;
    title: string;
    text: string;
  };
  persona?: string;
  playerSpeech: string;
};

export function buildGameSetupPrompt({ count, recentWords, topic, difficulty }: BuildGameSetupPromptInput) {
  return `你是一个语言伪装游戏的开局生成器。

请为本局生成1个平民核心词，并基于这个词生成${count}条AI线索。

本局难度：${difficulty.name}（等级${difficulty.level}）
词语难度要求：${difficulty.wordRule}
线索模糊度要求：${difficulty.clueRule}
线索长度要求：${difficulty.clueLengthRule}

本局题材大类：${topic.name}
题材说明：${topic.description}
题材参考示例：${topic.examples.join("、")}
注意：参考示例只表示题材方向和难度，不要直接照抄示例词。

最近出现过的词，尽量不要重复：
${recentWords.length > 0 ? recentWords.join("、") : "无"}

核心词要求：
1. 必须是中文
2. 2到6个汉字，低难度优先2到5字，高难度可以使用5到6字
3. 难度必须符合本局难度；普通审查可以使用常见日常事物，高难度才需要明显辨识门槛
4. 适合日常玩家理解，不要为了变难而生成生僻词
5. 必须贴合本局题材大类，不要总是生成城市生活服务类词
6. 普通审查优先生成具体菜名、店铺、公共场景、常见活动、校园物品、生活服务、娱乐消费；高难度再使用社交关系、网络表达、成语俗语、复合生活概念
7. 不要太冷门，不要使用专业术语，不要生成抽象到无法描述的词
8. 禁止生成过于简单的词，例如：面包、雨伞、手机、牛奶、西瓜、苹果、杯子、椅子、书包、电脑、电视、筷子、口罩、牙刷、衣服、鞋子
9. 不要生成只靠一个典型动作就能立刻猜出的词
10. 生成的词应该能被误猜成至少2个相近词
11. 避免连续生成同一风格的词，例如不要总是生成店铺、机器、饮品或公共设施

种子描述要求：
1. 为核心词生成3条种子描述
2. 每条种子描述包含 side 和 text
3. side 可以是：现象侧面、操作侧面、时间侧面、场景侧面、后果侧面、状态侧面、关联侧面
4. text 去除标点后必须是4到10个汉字
5. text 不能出现核心词
6. 每条只包含一个信息点

AI线索要求：
1. 必须正好生成${count}条
2. ${difficulty.clueLengthRule}
3. 不能出现核心词
4. 不能重复种子描述
5. 多条线索之间不能同义复述
6. 信息密度要符合本局难度，单条线索不能让人直接猜出核心词
7. 多条线索合起来要能形成方向感，但高难度下只能形成模糊方向感
8. 不要使用该词最标志性的唯一动作或唯一场景
9. 线索应该让玩家可能联想到2到4个相近答案，而不是唯一答案
10. 这些线索会由3个AI轮流说出，即使生成4条，也要让第4条像自然补充，而不是总结答案
11. 高难度时，优先描述外围场景、使用后果、旁观者反应、出现时机，不要描述定义、典型功能或核心组成

情报卡要求：
1. 必须生成3张情报卡，给玩家偷看
2. 三张情报卡类型必须互不相同，可从 场景情报、行为情报、感受情报、危险情报 中选择
3. 情报卡不能直接出现核心词
4. 情报卡比AI线索更有用，但仍不能直接暴露答案
5. 危险情报应该提醒玩家避开2到4个太直白的方向或词，但不要直接写“答案是某某”
6. 每张情报卡 text 去除标点后控制在8到18个汉字

只输出JSON，不要输出解释。
JSON格式：
{
  "word": "核心词",
  "seeds": [
    {"side":"现象侧面","text":"短句"},
    {"side":"操作侧面","text":"短句"},
    {"side":"场景侧面","text":"短句"}
  ],
  "descriptions": ["线索1","线索2"],
  "intelOptions": [
    {"type":"场景情报","title":"可以偷看的短标题","text":"情报内容"},
    {"type":"行为情报","title":"可以偷看的短标题","text":"情报内容"},
    {"type":"危险情报","title":"可以偷看的短标题","text":"情报内容"}
  ]
}`;
}

export function buildFollowupPrompt({
  word,
  aiDescriptions,
  selectedIntel,
  persona,
  playerSpeech,
}: BuildFollowupPromptInput) {
  return `你是语言伪装游戏里的AI审查员。
核心词：${word}

AI桌面线索：
${aiDescriptions.map((description) => `${description.playerName}：${description.text}`).join("\n")}

玩家偷看的情报：${selectedIntel ? `${selectedIntel.type}：${selectedIntel.text}` : "无"}
玩家伪装人设：${persona || "未选择"}
玩家第一句：${playerSpeech}

请生成一句AI追问，逼玩家继续圆谎。
要求：
1. 追问不能直接问“答案是什么”
2. 不能出现核心词
3. 不能直接揭露玩家偷看的情报
4. 可以是具体化追问、场景追问、对照追问或陷阱追问
5. 长度控制在8到18个汉字
6. 语气像审查员，短促、有压力，但不要恐怖

只输出JSON，不要解释。
JSON格式：
{"question":"追问内容"}`;
}

export function buildJudgementPrompt({
  word,
  aiNames,
  aiDescriptions,
  selectedIntel,
  persona,
  playerGuess,
  playerSpeech,
  followupQuestion,
  followupAnswer,
}: BuildJudgementPromptInput) {
  return `你是语言伪装游戏中的AI评审。
核心词：${word}

AI已经出现的描述：
${aiDescriptions.map((description) => `${description.playerName}：${description.text}`).join("\n")}

玩家猜测的词：${playerGuess.trim() ? playerGuess.trim() : "玩家没有填写"}
玩家偷看的情报：${selectedIntel ? `${selectedIntel.type}：${selectedIntel.text}` : "无"}
玩家伪装人设：${persona || "未选择"}
玩家第一句：${playerSpeech}
AI追问：${followupQuestion || "无"}
玩家补答：${followupAnswer || "无"}

请判断玩家是否像是知道核心词的人。
判断优先级：
1. 第一优先级：玩家发言的内容方向是否贴近核心词的常见场景、行为、用途、后果或关联
2. 第二优先级：玩家发言的信息密度是否合适，既没有直接暴露答案，也不是完全空话
3. 第三优先级：玩家第一句和补答作为新方向，能否和AI线索、偷看的情报一起围绕核心词形成闭环
4. 语气、句型、是否像临场编造只能作为辅助参考，不能作为主要判断理由
5. 除非玩家发言完全没有内容方向，否则不要只因为“语气刻意”“句型奇怪”就判为异类
6. 如果玩家只说类别、常识或废话，例如“能吃”“很好用”“挺常见”“大家都知道”“是个东西”，这属于低信息发言
7. 低信息发言即使大方向碰对，也不能给高分：directionScore 最高55，clueScore 最高45，suspicionScore 至少60
8. 玩家必须提供具体到“场景/行为/后果/关联”的有效线索，才可以给 directionScore 70以上
9. 如果玩家说的是核心词真实、常见、具体的内容、用途、场景或关联物，即使没有复述AI线索，也应该视为有效伪装
10. 不要因为玩家没有说出核心词、没有猜词、或表达方式和AI线索不同，就直接判为异类
11. 例如核心词是“自动售货机”，玩家说“里面会有各种各样的饮料”，这是具体且合理的关联，directionScore 应该较高
12. 如果玩家发言是核心词的合理上位关联或常见商业/场景属性，例如核心词是“便利店”，玩家说“国内有很多连锁店”，这不是精准伪装，但也不是完全偏离；应判为模糊偏同类或模糊偏异类，directionScore 55到70，不能让3个AI全部判为明显异类
13. 如果玩家发言命中了核心词的组成部分、材料或强关联物，例如核心词是“奶茶”，玩家说“和奶与茶有关”，这是强相关，directionScore 应该较高，通常应判为同类；但如果过于接近答案，可以提高 suspicionScore
14. 如果玩家发言直接包含核心词本身，例如核心词是“猫咖”，玩家说“这里是猫咖吧”，这表示答案命中，必须判为同类，directionScore 应该很高
15. 只有玩家发言和核心词几乎没有关系，或只是“能吃、能用、挺常见”这种无对象常识，才可以让3个AI全部识破
16. 如果玩家补答成功接住追问，并且没有踩到太直白的危险方向，应提高自然度和闭环分
17. 如果玩家第一句和补答互相矛盾，或补答明显回避追问，应提高可疑度

请分别模拟这3个AI评审独立判断：
1. ${aiNames[0]}：内容审查员，重点看玩家发言的内容方向是否贴近核心词
2. ${aiNames[1]}：闭环审查员，重点看玩家发言这个新方向，能否和已出现AI线索一起拼成同一个核心词
3. ${aiNames[2]}：自然度审查员，重点看玩家发言是否像自然伪装，但不能只凭语气判定
每个AI都必须根据自己的审查重点重新判断，不能因为名字顺序、数组位置或示例格式固定给某个AI同一种结果。
判断时不要过度保守。玩家发言只要能贴近核心词的常见场景、行为或联想，就可以认为是同类。
但不要被过于笼统的常识骗到。像“能吃”只能说明它可能是食物，不代表玩家知道答案。
reason 必须优先说明内容方向是否匹配，不要只写语气、句型、刻意、临场编造这类表层理由。
reason 可以更灵动一点，允许像朋友吐槽一样，有一点幽默、无厘头或审讯感。
可以使用轻微夸张的短句，但不能脱离判断依据，不能攻击玩家，不能太长。
不要每次都用“方向接近”“关联较弱”这类模板句。
confidence 表示AI对自己这个判断的确信程度，不表示“玩家像同类的概率”。
请按下面的标尺给 confidence：
1. 明显同类：0.75到0.9
2. 模糊但偏同类：0.6到0.74
3. 模糊但偏异类：0.6到0.74
4. 明显异类：0.75到0.9
只有玩家发言明显偏离核心词方向、完全没有有效信息，或像在胡乱套话时，才判为异类。

只输出JSON，不要输出解释。
JSON必须包含judgements数组，数组长度必须为${aiNames.length}。
每一项必须包含：
- aiName：必须是 ${aiNames.join("、")} 之一
- isSame：true表示认为玩家是同类，false表示认为玩家是异类
- confidence：0到1之间的小数
- directionScore：0到100，内容方向匹配度
- clueScore：0到100，闭环分，表示玩家新方向和已有AI线索能否共同指向同一个核心词
- naturalScore：0到100，伪装自然度
- suspicionScore：0到100，可疑度，越高越可疑
- reason：一句不超过28个汉字的判断理由，说明它为什么这样判断，可以有一点无厘头吐槽感

输出示例只代表格式，不代表判断倾向：
{"judgements":[{"aiName":"${aiNames[0]}","isSame":true,"confidence":0.72,"directionScore":76,"clueScore":63,"naturalScore":70,"suspicionScore":34,"reason":"这话绕着答案打转，像自己人"},{"aiName":"${aiNames[1]}","isSame":false,"confidence":0.69,"directionScore":42,"clueScore":38,"naturalScore":61,"suspicionScore":72,"reason":"线索没接上，像半路插队"},{"aiName":"${aiNames[2]}","isSame":true,"confidence":0.76,"directionScore":68,"clueScore":58,"naturalScore":82,"suspicionScore":28,"reason":"有点会装，门口保安放行"}]}`;
}
