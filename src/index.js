const Porcupine = require("@picovoice/porcupine-node");
const {
    BUILTIN_KEYWORDS_STRING_TO_ENUM,
    getBuiltinKeywordPath,
} = require("@picovoice/porcupine-node/builtin_keywords");
const recorder = require("node-record-lpcm16");
const speech = require('@google-cloud/speech');
const proc = require("child_process");
const puppeteer = require("puppeteer");
const axios = require("axios");

const MAX_LISTEN_TIME = 20000;
const RECORDER_TYPE = "arecord";
const KEYWORDS = ["grasshopper"];
const SENSITIVITIES = KEYWORDS.map( el => 0.5 );
const KEYWORD_PATHS = KEYWORDS.map( el => getBuiltinKeywordPath( BUILTIN_KEYWORDS_STRING_TO_ENUM.get(el) ) );
const SAMPLE_RATE_HERTZ = 16000;
const GOOGLE_CONFIG = {
    encoding: "LINEAR16",
    sampleRateHertz: SAMPLE_RATE_HERTZ,
    languageCode: 'en-US',
};
const GOOGLE_REQUEST = {
    config: GOOGLE_CONFIG,
    interimResults: false, // Get interim results from stream
};
const CHARLOTTE_URL = "https://www.tvpassport.com/lineups/set/95354D?lineupname=Spectrum+-+Charlotte%2C+NC+&tz=America/New_York";
const LINEUP_INTERVAL = 1000 * 60 * 10;
const HARMONY_URL = "http://localhost:8282/hubs/papa/devices/";
const GIT_FETCH_COMMAND = "git -C /home/pi/papa-voice fetch";
const GIT_UPDATES_AVAILABLE_COMMAND = 'if [ $(git -C /home/pi/papa-voice rev-parse HEAD) != $(git -C /home/pi/papa-voice rev-parse @{u}) ]; then echo "1"; else echo "0"; fi;';
const GIT_PULL_COMMAND = "git -C /home/pi/papa-voice pull";
const GIT_PULL_INTERVAL = 1000 * 60 * 5;

// List of channels that Papa gets - taken from here: https://www.spectrum.com/cable-tv/channel-lineup
// Gold package
// JSON.stringify([...document.querySelectorAll(".clu-table:not(.table_headers,.header) .nogutter:first-child .small.sortable")].map(el => parseInt(el.innerText)))
const CHANNELS = [2,4,5,6,8,13,15,1275,1276,1277,1,3,9,10,11,12,17,18,19,21,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,74,75,76,78,79,80,81,86,87,88,89,90,92,93,95,109,110,119,124,125,127,128,130,131,133,134,135,136,137,140,141,151,159,161,163,165,169,171,174,175,176,177,179,180,182,184,185,187,188,189,194,195,198,207,209,210,215,221,222,224,226,227,232,253,254,255,256,262,263,265,266,286,287,288,290,291,292,295,297,299,302,306,308,310,312,315,316,324,325,370,375,376,377,378,379,380,381,382,384,385,386,388,392,401,402,406,413,417,442,443,444,463,464,465,468,469,470,472,474,476,477,478,481,484,490,495,496,511,512,513,514,515,516,517,551,552,553,554,555,556,557,558,571,572,581,582,583,584,585,586,602,603,604,605,606,607,608,620,621,622,623,625,627,632,640,803,811,827,898,899,1233,1240,1245,1247,1250,1251,1255,1256,1260,1261,1263,1265,1278,1279,1295,1296,1554,1901,1902,1903,1905,1906,1907,1908,1909,1910,1911,1912,1913,1914,1915,1916,1917,1918,1919,1920,1921,1922,1923,1924,1925,1926,1927,1928,1929,1930,1931,1932,1933,1934,1935,1936,1937,1938,1939,1940,1941,1942,1943,1944,1945,1946,1947,1948,1949,1950];

let lineup = {};
let prevCommand = null;
let cursor = 0;

/**
 * List of commands
 *      On
 *      Off
 *      Volume Down
 *      Volume Up
 *      Spectrum
 *      Roku
 *      Amazon
 *      Watch <Channel>
 *      Watch <Keyword - Channel, Type(Movie or Sport), or Keyword in name>
 */

// pipe to this stream when we want translation results
let currentlyStreamingToGoogle = false;

/**
 * Main function.
 */
async function main() {
    fetchLineup();
    listen();
    update();
}

function update() {
    console.log("Checking for updates");
    try {
        proc.execSync( GIT_FETCH_COMMAND );
        let updatesAvailable = parseInt(proc.execSync( GIT_UPDATES_AVAILABLE_COMMAND ).toString());
        if( updatesAvailable ) {
            console.log("Updating");
            proc.execSync(GIT_PULL_COMMAND);
            restart();
        }
    }
    catch(err) {
        console.log(err);
    }
    setTimeout( update, GIT_PULL_INTERVAL );
}

/**
 * Listen.
 */
function listen() {
    detectHotword( ( recording ) => {
        if( !currentlyStreamingToGoogle ) {
            pipeToGoogle( recording );
        }
    } );
}

/**
 * Set up Google Pipe.
 * It will end once we receive the translation.
 * @param {Recording} recording - The recording from the microphone.
 * See here for more: https://github.com/googleapis/nodejs-speech/blob/master/samples/MicrophoneStream.js#L71
 */
function pipeToGoogle( recording ) {
    const client = new speech.SpeechClient();
    currentlyStreamingToGoogle = true;
    console.log("Started pipe to Google");
    
    let stopGoogleStreamTimeout;
    let stopGoogleStream = function() {
        clearTimeout( stopGoogleStreamTimeout );
        recording.stream().unpipe( recognizeStream ); // this will pause the stream (can be resumed)
        // it will get garbage collected
        recognizeStream.end();
        console.log("Stopped pipe to Google");
        currentlyStreamingToGoogle = false;
        // the input has also stopped, so we have to restart the program
        listen();
    }
    let recognizeStream = client
        .streamingRecognize(GOOGLE_REQUEST)
        .on('error', console.error)
        .on('data', data => {
            stopGoogleStream();
            if( data.results[0] && data.results[0].alternatives[0] ) {
                console.log(`Transcription: ${data.results[0].alternatives[0].transcript}`);
                handleGoogleResult(data.results[0].alternatives[0].transcript);
            }
        });
    stopGoogleStreamTimeout = setTimeout( stopGoogleStream, MAX_LISTEN_TIME );
    recording.stream().pipe( recognizeStream );
}

/**
 * Handle a transcripted result from Google.
 * You can find commands here: https://github.com/maddox/harmony-api.
 **/
function handleGoogleResult( text ) {
    text = replaceSpecial(text);
    
    // how many times in a row the command has been said
    if( text != prevCommand ) cursor = 0;
    else cursor++;
    prevCommand = text;
    
    while( text.match(/^grasshopper/) ) text = text.replace(/^grasshopper/g,"").trim();
    if( text == "turn on" ) text = "on";
    if( text == "turn off" ) text = "off";
    if( text == "watch amazon" ) text = "amazon";
    if( text == "watch spectrum" ) text = "spectrum";
    if( text == "watch roku" ) text = "roku";
    if( text == "turn volume up" ) text = "volume up";
    if( text == "turn volume down" ) text = "volume down";
    
    switch(text) {
        case "on":
            console.log("Turning TV On");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "power-on"
                }
            ] );
            break;
        case "off":
            console.log("Turning TV Off");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "power-off"
                }
            ] );
            break;
        case "volume down":
            console.log("Lowering TV Volume");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "volume-down?repeat=5"
                }
            ] );
            break;
        case "volume up":
            console.log("Increasing TV Volume");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "volume-up?repeat=5"
                }
            ] );
            break;
        case "spectrum":
            console.log("Going to Spectrum");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "inputhdmi1"
                }
            ] );
            break;
        case "roku":
            console.log("Going to Roku");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "inputhdmi2"
                }
            ] );
            break;
        case "amazon":
            console.log("Going to Amazon");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "inputhdmi1"
                },
                {
                    device: "roku-streaming-stick",
                    command: "home"
                },
                {   sleep: 100 },
                {
                    device: "roku-streaming-stick",
                    command: "direction-right?repeat=2"
                },
                {
                    device: "roku-streaming-stick",
                    command: "select"
                },
                {   sleep: 400 },
                {
                    device: "roku-streaming-stick",
                    command: "direction-right"
                },
                {
                    device: "roku-streaming-stick",
                    command: "select"
                }
            ] );
            break;
        default:
            let match = text.match(/^watch\s(.+)/);
            if( match ) {
                function enterChannelNumber( number ) {
                    let commands = number.toString().split("").map( el => {
                        return {
                            device: "samsung-tv",
                            command: el
                        }
                    });
                    console.log("Setting channel to " + number);
                    runCommands(commands);
                }
                let value = replaceSpecial(match[1]);
                if( parseInt( value ) ) {
                    enterChannelNumber( value );
                }
                else {
                    let results = Object.values( lineup ).filter( el => {
                        let count = 0;
                        for( let val of value.split(" ") ) {
                            if( el.name.match( val ) ||
                            el.program.show.match( val ) ||
                            el.program.episode.match( val ) ||
                            el.program.type.match( val ) ) {
                                count++;
                            }
                        }
                        el.count = count;
                        return count > 0;
                    } );
                    results = results.sort( (a,b) => {
                        if( a.count > b.count ) return -1;
                        if( b.count > a.count ) return 1;
                        if( parseInt(a.number) < parseInt(b.number) ) return -1;
                        if( parseInt(b.number) < parseInt(b.number) ) return 1;
                        return 0;
                    } );
                    if( results.length ) {
                        if( cursor >= results.length ) cursor = 0;
                        console.log("Matched: " + results[cursor].name);
                        enterChannelNumber( results[cursor].number );
                    }
                }
            }

    }
}

/**
 * Replace special characters and lowercase a string.
 * @param {string} text - The text to manipulate.
 * @returns {string} The manipulated text.
 */
function replaceSpecial( text ) {
    return text.replace(/[&\/\\#,+()$~%.'":*?<>{}-]/g,'').replace(/\s\s+/g, ' ').toLowerCase().trim();
}

/**
 * Sleep a given number of milliseconds
 * @param {number} milliseconds - The number of milliseconds to sleep.
 */
function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/**
 * Run commands to the harmony API
 * @param {Array} commands - The array of commands
 */
async function runCommands( commands ) {
    for( let command of commands ) {
        console.log("Running command: " + JSON.stringify(command));
        if( command.sleep ) await sleep(command.sleep);
        else {
            try {
                await axios.post( HARMONY_URL + command.device + "/commands/" + command.command );
            }
            catch(err) { console.log(err) }
        }
        await sleep(100);
    }
}

/**
 * Detect a hotword.
 * @param {Function} [callback] - The callback to run once a hotword is detected.
 * Modified from here: https://github.com/Picovoice/porcupine/blob/master/demo/nodejs/mic.js
 */
function detectHotword(callback) {
    let handle = new Porcupine(
        KEYWORD_PATHS,
        SENSITIVITIES
    );

    let recorderType = RECORDER_TYPE;

    const frameLength = handle.frameLength;
    const sampleRate = handle.sampleRate;

    let recording = recorder.record({
        sampleRate: sampleRate,
        channels: 1,
        audioType: "raw",
        recorder: recorderType,
        sampleRateHertz: SAMPLE_RATE_HERTZ
    });

    let frameAccumulator = [];

    recording.stream().on("data", (data) => {
        // Two bytes per Int16 from the data buffer
        let newFrames16 = new Array(data.length / 2);
        for (let i = 0; i < data.length; i += 2) {
            newFrames16[i / 2] = data.readInt16LE(i);
        }

        // Split the incoming PCM integer data into arrays of size Porcupine.frameLength. If there's insufficient frames, or a remainder,
        // store it in 'frameAccumulator' for the next iteration, so that we don't miss any audio data
        frameAccumulator = frameAccumulator.concat(newFrames16);
        let frames = chunkArray(frameAccumulator, frameLength);

        if (frames[frames.length - 1].length !== frameLength) {
            // store remainder from divisions of frameLength
            frameAccumulator = frames.pop();
        }
        else {
            frameAccumulator = [];
        }

        for (let frame of frames) {
            let index = handle.process(frame);
            if (index !== -1) {
                console.log(`Detected '${KEYWORDS[index]}'`);
                if( callback ) callback( recording );
            }
        }
    });

    console.log(`Listening for wake word(s): ${KEYWORDS}`);
    process.stdin.resume();
}

/**
 * Chunk an array.
 */
function chunkArray(array, size) {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, index) =>
        array.slice(index * size, index * size + size)
    );
}

/**
 * Fetch lineup.
 */
async function fetchLineup() {
    console.log("Fetching lineup");
    try {
        let browser = await puppeteer.launch({headless: true, product: 'chrome', executablePath: '/usr/bin/chromium-browser' });
        let page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; CrOS armv7l 13597.84.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.187 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
        });
        await page.goto(CHARLOTTE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitFor(15000);
        console.log("Page loaded");
        let newLineup = await page.evaluate( (CHANNELS) => {
            let channels = document.querySelectorAll("#top .channel_col");
            let newLineup = {};
            channels.forEach( el => {
                let number = el.querySelector(".channel-number").innerText
                if( !parseInt(number) ) return;
                // Only include valid channels
                if( CHANNELS.indexOf(parseInt(number)) === -1 ) return;
                if( !el.nextElementSibling ) return;
                let listingCell = el.nextElementSibling.querySelector(".listing_cell");
                if( !listingCell ) return;
                let channel = {
                    name: el.querySelector(".channel_cell").getAttribute("title"),
                    program: {
                        show: listingCell.querySelector(".showtitle") ? listingCell.querySelector(".showtitle").innerText : "",
                        episode: listingCell.querySelector(".episode-title") ? listingCell.querySelector(".episode-title").innerText : "",
                        type: listingCell.classList.contains("showtype-O") ? "sport" : listingCell.classList.contains("showtype-M") ? "movie" : ""
                    },
                    number: number
                };
                newLineup[number] = channel;
            } );
            return newLineup;
        }, CHANNELS );
        console.log(Object.keys(newLineup).length);
        for( let key in newLineup ) {
            newLineup[key].name = replaceSpecial(newLineup[key].name);
            newLineup[key].program.show = replaceSpecial(newLineup[key].program.show);
            newLineup[key].program.episode = replaceSpecial(newLineup[key].program.episode);
        }
        lineup = newLineup;
        browser.close();
    }
    catch(err) {
        console.log(err);
    }
    console.log("Lineup fetched");
    console.log(lineup);
    setTimeout(fetchLineup, LINEUP_INTERVAL);
}

main();

// Restart the process if there is an error
process.on('uncaughtException', function (err) {
    console.error(err.stack);
    restart();
});

/**
 * Restart the program
 */
function restart() {
    process.on("exit", function () {
        proc.spawn(process.argv.shift(), process.argv, {
            cwd: process.cwd(),
            detached : true,
            stdio: "inherit"
        });
    });
    process.exit();
}
