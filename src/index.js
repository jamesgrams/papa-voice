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
const LINEUP_INTERVAL = 1000 * 60 * 5;
const HARMONY_URL = "http://localhost:8282/hubs/papa/devices/";

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
    //listen();
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
                handleGoogleResult(data.results[0].alternatives[0]);
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
    text = text.toLowerCase();
    
    // how many times in a row the command has been said
    if( text != prevCommand ) cursor = 0;
    else cursor++;
    prevCommand = text;
    
    switch(text) {
        case "on":
            console.log("Turning TV On");
            runCommands( [ 
                {
                    device: "samsung-tv",
                    command: "power-on"
                },
                {
                    device: "arris-dvr",
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
            let match = result.match(/^watch\s(.+)/
            if( match ) {
                function enterChannelNumber( number ) {
                    let commands = number.toString().split("").map( el => {
                        return {
                            device: "samsung-tv",
                            command: el
                        }
                    };
                    console.log("Setting channel to " + number);
                    runCommands(commands);
                }
                if( parseInt( match[1] ) {
                    enterChannelNumber( match[1] );
                }
                else {
                    let results = Object.values( lineup ).filter( el =>
                        el.name.match( match[1] ) ||
                        el.program.show( match[1] ) ||
                        el.program.episode( match[1] ) ||
                        el.program.type( match[1] )
                    );
                    if( results.length ) {
                        if( cursor >= results.length ) cursor = 0;
                        enterChannelNumber( results[cursor].number );
                    }
                }
            }

    }
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
        if( command.sleep ) await sleep(command.sleep);
        else await axios.post( HARMONY_URL + command.device + "/commands/" + command.command );
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
        await page.goto(CHARLOTTE_URL, { waitUntil: 'domcontentloaded' });
        await page.waitFor(45000);
        console.log("Page loaded");
        let newLineup = await page.evaluate( () => {
            let channels = document.querySelectorAll("#top .channel_col");
            let newLineup = {};
            channels.forEach( el => {
                let number = el.querySelector(".channel-number").innerText
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
        } );
        console.log(Object.keys(newLineup).length);
        lineup = newLineup;
    }
    catch(err) {
        console.log(err);
    }
    console.log("Lineup fetched");
    console.log(lineup);
    setTimeout(fetchLineup, LINEUP_INTERVAL);
}

main();
