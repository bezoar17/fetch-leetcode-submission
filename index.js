// 1. Config...
// Available field: title, runtime, url, questionId.
const mdTemplate = `
### {{questionId}}. [{{title}}]({{url}})
\`\`\`{{lang}}
{{code}}
\`\`\`
##Note
\`\`\`
{{question_note}}
\`\`\`
##QuestionContent
\`\`\`
{{question_content}}
\`\`\`
`;
const header = '';
const footer = '';
const waitTime = 300;
const backOffTime = 10_000; // wait 10 seconds to backoff on rate-limit
const onlyFetchFirstPage = false;
// config end

_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;
async function pause(time) {
  return new Promise((resolve) => { setTimeout(() => { resolve() }, time) });
}

async function getSubmission(page) {
  var offset = page * 20;
  var url = `/api/submissions/?offset=${offset}&limit=20&lastkey=${lastkey}`;
  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      success: function (data) {
        lastkey = data.last_key
        resolve(data);
      },
      error: function () {
        resolve('failed');
      },
    });
  });
}

async function getNoteForQuestion(questionSlug) {
  var url = `/graphql`;
  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        query: "query questionNote($titleSlug: String!) {\n  question(titleSlug: $titleSlug) {\n    questionId\n    note\n  }\n}\n",
        variables: { "titleSlug": questionSlug }
    }),
      success: function (data) {
        resolve(data);
      },
      error: function () {
        resolve('failed');
      },
    });
  });
}

async function getQuestionContent(questionSlug) {
  var url = `/graphql`;
  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({
        query: "query questionContent($titleSlug: String!) {\n  question(titleSlug: $titleSlug) {\n    content\n difficulty\n topicTags{\n name\n id\n slug}\n  }\n}\n",
        variables: { "titleSlug": questionSlug }
    }),
      success: function (data) {
        resolve(data);
      },
      error: function () {
        resolve('failed');
      },
    });
  });
}

async function getSolution(url) {
  return new Promise((resolve) => {
    $.ajax({
      url: url,
      success: function (content) {
        resolve(content);
      },
      error: function () {
        resolve('failed');
      },
    });
  });
}

// 2. fetch submisstion
let lastkey = '';
const submissions = [];
for (let i = 0; onlyFetchFirstPage ? i < 1 : true; i++) {
  await pause(waitTime);
  let retry_count = 0;
  let data = await getSubmission(i);
  while (data == 'failed') {
    console.log('retry after 10s');
    await pause(backOffTime);
    data = await getSubmission(i);
    retry_count+=1;
    if (retry_count > 20){break}
  }
  
  console.log('success');
  [].push.apply(submissions, data.submissions_dump);

  if (retry_count > 20) {
    console.log('Quitting, retried max times with failed result');
    break;
  }

  if (!data.has_next) {
    break;
  }
}

console.log(submissions);
const accepts = _.chain(submissions)
  .filter((i) => i.status_display === 'Accepted')
  .uniqBy('title').value();


// 3. fetch solution
const solutions = [];
let start, end, solution, item;
for (let i = 0; i < accepts.length; i++) {
  item = accepts[i];
  await pause(waitTime);
  let content = await getSolution(item.url);
  while (content == 'failed') {
    await pause(waitTime);
    content = await getSolution(item.url);
  }
  start = content.indexOf('pageData');
  end = content.indexOf('if (isNaN(pageData.submissionData.status_code)');
  codeObj = eval(content.slice(start, end));
  console.log(codeObj);

  let note_content = await getNoteForQuestion(item.title_slug);
  while (note_content == 'failed') {
    await pause(waitTime);
    note_content = await getNoteForQuestion(item.title_slug);
  }
  let question_note = note_content.data.question.note;

  let q_content = await getQuestionContent(item.title_slug);
  while (q_content == 'failed') {
    await pause(waitTime);
    q_content = await getQuestionContent(item.title_slug);
  }
  let question_content = q_content.data.question.content;
  let question_difficulty = q_content.data.question.difficulty;
  let topic_tags = q_content.data.question.topicTags.map(i => i.slug);
  question_content = question_content.replace(/\n/g, ' ').replace(/\t/g, ' ');

  solutions.push({
    title: item.title,
    code: codeObj.submissionCode,
    url: `https://leetcode.com${codeObj.editCodeUrl}description/`,
    questionId: codeObj.questionId,
    lang: item.lang,
    question_note: question_note,
    question_content: question_content,
    question_difficulty: question_difficulty,
    question_topics: topic_tags
  });
}
solutions.sort((a, b) => parseInt(a.questionId) - parseInt(b.questionId))


// 4. generate the md file
let content = header;
const compiled = _.template(mdTemplate)
content += _.reduce(solutions, (memo, curr) => {
  memo += compiled(curr) + '\r\n';
  return memo;
}, '');
content += footer;

// 5. download
const saveData = (function () {
  let a = document.createElement("a");
  document.body.appendChild(a);
  a.style = "display: none";
  return function (data, fileName) {
    blob = new Blob([data], { type: "octet/stream" }), url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  };
}());

// saveData(content, 'README.md')
saveData(JSON.stringify(solutions), 'LEETCODE.json')

