/**
 * BeatPeggiator
 * @author Michael Caterisano
 * @license http://opensource.org/licenses/MIT MIT License
 * @copyright 2020 Michael Caterisano
 */

var NeedsTimingInfo = true;
var activeNotes = [];
var currentPosition = 0;
var beatMap = [];
var delays = [];
var beatPositions = [];
var newBeat = true;
var prevBeat = null;
var currentBeat = null;
var firstTime = true;
var prevDenominator = null;
var availableNotes = [];
var sentNotes = [];
//var manualActiveNotes = [];

function HandleMIDI(event) {
  var musicInfo = GetTimingInfo();

  if (event instanceof NoteOn) {
    // add note to array
    activeNotes.push(event);
  } else if (event instanceof NoteOff) {
    // remove note from array
    for (i = 0; i < activeNotes.length; i++) {
      if (activeNotes[i].pitch == event.pitch) {
        activeNotes.splice(i, 1);
        break;
      }
    }
  }

  if (activeNotes.length === 0) {
    Reset();
  }

  activeNotes.sort(sortByPitchAscending);
}

//-----------------------------------------------------------------------------
function sortByPitchAscending(a, b) {
  if (a.pitch < b.pitch) return -1;
  if (a.pitch > b.pitch) return 1;
  return 0;
}

//-----------------------------------------------------------------------------
var wasPlaying = false;

function ProcessMIDI() {
  // Get timing information from the host application
  var musicInfo = GetTimingInfo();

  if (activeNotes.length === 0) {
    prevBeat = null;
  }

  // clear activeNotes[] when the transport stops and send any remaining note off events
  if (wasPlaying && !musicInfo.playing) {
    for (i = 0; i < activeNotes.length; i++) {
      var off = new NoteOff(activeNotes[i]);
      off.send();
    }
  }

  wasPlaying = musicInfo.playing;

  if (activeNotes.length != 0) {
    // get parameters
    var division = GetParameter('Beat Division');
    var numBeats = GetParameter('Number Of Notes');
    var randomDelay =
      Math.random() * ((GetParameter('Random Delay') / 100) * (1 / division));

    // calculate beat to schedule
    var lookAheadEnd = musicInfo.blockEndBeat;

    // calculate new positions if new beat
    if (newBeat) {
      Trace('NEW BEAT/////////////////////');
      //prevBeatPositions = beatPositions;
      //manualActiveNotes = [...activeNotes];
      beatMap = generateBeatMap(numBeats, division);
      delays = generateNoteDelays(beatMap, 1 / division);
      beatPositions = getBeatPositions();
      newBeat = false;
      firstTime = false;
      prevDenominator = GetParameter('Beats');

      var newBeatState = {
        //firstTime: firstTime,
        //denom: GetParameter("Beats"),
        //beatMap: beatMap,
        //delays: delays,
        now: musicInfo.blockStartBeat,
        beatPositions: beatPositions,
      };

      Trace(JSON.stringify(newBeatState));
    }

    var nextBeat = beatPositions[currentPosition];

    // when cycling, find the beats that wrap around the last buffer
    if (musicInfo.cycling && lookAheadEnd >= musicInfo.rightCycleBeat) {
      if (lookAheadEnd >= musicInfo.rightCycleBeat) {
        beatPositions = delays.map((delay) => {
          return musicInfo.leftCycleBeat + delay;
        });
        var cycleBeats = musicInfo.rightCycleBeat - musicInfo.leftCycleBeat;
        var cycleEnd = lookAheadEnd - cycleBeats;
      }
    }

    // loop through the beats that fall within this buffer
    while (
      (nextBeat >= musicInfo.blockStartBeat && nextBeat < lookAheadEnd) ||
      // including beats that wrap around the cycle point
      (musicInfo.cycling && nextBeat < cycleEnd)
    ) {
      // adjust for cycle
      if (musicInfo.cycling && nextBeat >= musicInfo.rightCycleBeat) {
        Trace('RIGHT CYCLE-------------');

        nextBeat -= cycleBeats;
        // wrap beatPositions around cycle
        beatPositions = delays.map((delay) => {
          return musicInfo.leftCycleBeat + delay;
        });
      }

      sendNote(nextBeat, randomDelay);
      if (numBeats === 1) {
        newBeat = true;
        break;
      }

      // advance to next beat
      nextBeat += 0.001;

      // if position out of bounds, reset and break
      if (currentPosition >= beatPositions.length - 1) {
        currentPosition = 0;
        newBeat = true;
        break;
      } else {
        currentPosition += 1;
        nextBeat = beatPositions[currentPosition];
      }
    }
  }
}
//-----------------------------------------------------------------------------
function Reset() {
  //Trace("RESET///////////");
  activeNotes = [];
  availableNotes = [];

  currentPosition = 0;
  beatMap = [];
  delays = [];
  beatPositions = [];
  newBeat = true;
  firstTime = true;
  prevBeat = null;

  //manualActiveNotes = [];
}

//-----------------------------------------------------------------------------
function getBeatPositions(nextBeat) {
  var musicInfo = GetTimingInfo();
  var positions = [];
  var division = GetParameter('Beat Division');
  var denominator = getDenominator();
  var firstBeat = true;
  positions = delays.map((delay) => {
    if (firstTime) {
      prevBeat = setPrevBeat();
      //Trace("step 1 prevBeat: " + prevBeat);
      //Trace("called on: " + musicInfo.blockStartBeat);
      return prevBeat + delay;
    } else if (!firstTime) {
      if (firstBeat) {
        //Trace("step 2 " + prevBeat);
        prevBeat = prevBeat + denominator;
        currentBeat = prevBeat;
        firstBeat = false;
      }

      return currentBeat + delay;
    }
    if (musicInfo.blockStartBeat < musicInfo.leftCycleBeat) {
      return Math.ceil(musicInfo.blockStartBeat) + delay;
    }
  });
  return positions;
}
//-----------------------------------------------------------------------------
function getDenominator() {
  var currentDenominator = GetParameter('Beats');
  if (currentDenominator !== prevDenominator) {
    return prevDenominator;
  } else {
    return currentDenominator;
  }
}

//-----------------------------------------------------------------------------
function setPrevBeat() {
  var musicInfo = GetTimingInfo();

  if (
    musicInfo.cycling &&
    Math.round(musicInfo.blockStartBeat) === musicInfo.rightCycleBeat
  ) {
    //Trace("setPrevBeat END CYCLE/////");
    return musicInfo.leftCycleBeat;
  } else {
    //Trace("setPrevBeat NORMAL/////");
    return Math.ceil(musicInfo.blockStartBeat);
  }
}

//-----------------------------------------------------------------------------

function sendNote(nextBeat, randomDelay) {
  var musicInfo = GetTimingInfo();
  var division = GetParameter('Beat Division');
  var noteOrder = GetParameter('Note Order');
  var noteLength = (GetParameter('Note Length') / 100) * (1 / division);
  var randomLength =
    Math.random() * ((GetParameter('Random Length') / 100) * (1 / division));
  sentNotes = [];

  if (availableNotes.length === 0) {
    availableNotes = [...activeNotes];
  }

  //Trace("AVAILABLE: " + availableNotes.map((note) => note.pitch));

  if (availableNotes.length !== 0) {
    var simultaneousNotes = GetParameter('Simultaneous Notes');
    var iterations =
      simultaneousNotes > activeNotes.length
        ? activeNotes.length
        : simultaneousNotes;
    for (var i = 0; i < iterations; i++) {
      //var selectedNote = getAndRemoveRandomItem(availableNotes);
      //var step = Math.floor(nextBeat / (1 / division) - division);
      var selectedNote = chooseNote(noteOrder);

      while (sentNotes.includes(selectedNote.note.pitch)) {
        Trace('WHILE: ' + selectedNote.note.pitch);
        selectedNote = chooseNote(noteOrder);
      }

      availableNotes.splice(selectedNote.index, 1);

      var noteToSend = new NoteOn();
      noteToSend.pitch = selectedNote.note.pitch;
      sentNotes.push(selectedNote.note.pitch);
      noteToSend.sendAtBeat(nextBeat + randomDelay);
      //Trace("NOTE: " + selectedNote.pitch + " | BEAT: " + nextBeat.toFixed(2));

      noteOffToSend = new NoteOff(noteToSend);
      // noteOffToSend.sendAfterMilliseconds(
      //   (noteLength + randomLength) * (60000 / info.tempo)
      // );

      var noteOffBeat = nextBeat + noteLength + randomLength + randomDelay;
      if (musicInfo.cycling && noteOffBeat >= musicInfo.rightCycleBeat) {
        noteOffToSend.sendAtBeat(musicInfo.rightCycleBeat);
      } else {
        noteOffToSend.sendAtBeat(noteOffBeat);
      }

      Trace(
        'NOTE: ' +
          noteToSend.pitch +
          ' ON: ' +
          (nextBeat + randomDelay) +
          ' OFF: ' +
          (nextBeat + noteLength + randomLength + randomDelay)
      );
    }
    Trace('SENT: ' + sentNotes.sort((a, b) => a - b));
    Trace(sentNotes.length === new Set(sentNotes).size);
  }

  //Trace("NOTES SENT: " + sentNotes + "**********");
}

//-----------------------------------------------------------------------------
function getAndRemoveRandomItem(arr, noteOrder, currentPosition) {
  if (arr.length !== 0) {
    var index = Math.floor(Math.random() * arr.length);
    return arr.splice(index, 1)[0];
  }
}

//-----------------------------------------------------------------------------
var noteOrders = ['up', 'down', 'random'];

function chooseNote(noteOrder) {
  // if (availableNotes.length === 0) {
  //   availableNotes = [...activeNotes];
  // }
  if (availableNotes.length === 0) {
    Trace('WAS ZERO');
    availableNotes = [...activeNotes];
  }
  var order = noteOrders[noteOrder];
  var length = availableNotes.length;
  if (order === 'up') {
    //var index = step % length;
    return { note: availableNotes[0], index: 0 };
  }
  if (order === 'down') {
    //var index = Math.abs((step % length) - (length - 1));
    return {
      note: availableNotes[availableNotes.length - 1],
      index: availableNotes.length - 1,
    };
  }
  if (order === 'random') {
    var index = Math.floor(Math.random() * length);
    return { note: availableNotes[index], index: index };
  } else {
    return 0;
  }
}
//-----------------------------------------------------------------------------
function generateBeatMap(numNotes, beatDivision) {
  // create array of size beatDivision and fill with index numbers
  var arr = new Array(beatDivision);
  for (var i = 0; i < beatDivision; i++) {
    arr[i] = i;
  }

  // randomly choose numNotes number of indices from array
  // these will be the beatDivisions that have a note
  var indices = [];
  for (var i = 0; i < numNotes; i++) {
    var index = getAndRemoveRandomItem(arr);
    indices.push(index);
  }

  // create output array like [1, 0, 1, 1] where 1 represents a note
  // 0 represents a rest, and the array length represents the number of
  // beat divisions
  var output = new Array(beatDivision).fill(0);
  for (var i = 0; i < indices.length; i++) {
    var index = indices[i];
    output[index] = 1;
  }
  return output;
}

//-----------------------------------------------------------------------------
// returns array of note delays in milliseconds,
//e.g. [0, 255, 255, 255] for beatmap [1, 1, 1, 1] at 60bpm
function generateNoteDelays(beatMap, offsetAmount) {
  var output = [];

  for (var i = 0; i < beatMap.length; i++) {
    if (beatMap[i] === 1) {
      output.push(offsetAmount * (i * GetParameter('Beats')));
    }
  }
  return output;
}
//-----------------------------------------------------------------------------
function ParameterChanged(param, value) {
  var musicInfo = GetTimingInfo();
  if (param === 0) {
    // Beat Division
    if (value < GetParameter('Number Of Notes')) {
      SetParameter(1, value);
    } else {
    }
  }
  if (param === 1) {
    // Number Of Notes
    if (value === 1) {
      beatPositions = delays.map((delay) => {
        return Math.ceil(musicInfo.blockStartBeat) + delay;
      });
      currentPosition = 0;
      nextBeat = beatPositions[currentPosition];
    }
    if (value > GetParameter('Beat Division')) {
      SetParameter('Beat Division', value);
    }
  }

  // if (param === 2) {
  //   // Beats
  // }
}
//-----------------------------------------------------------------------------
var PluginParameters = [
  {
    name: 'Beat Division',
    type: 'linear',
    minValue: 1,
    maxValue: 64,
    numberOfSteps: 63,
    defaultValue: 4,
  },
  {
    name: 'Number Of Notes',
    type: 'linear',
    minValue: 1,
    maxValue: 64,
    numberOfSteps: 63,
    defaultValue: 4,
  },
  {
    name: 'Beats',
    type: 'linear',
    minValue: 1,
    maxValue: 10,
    numberOfSteps: 9,
    defaultValue: 1,
  },

  {
    name: 'Note Order',
    type: 'menu',
    valueStrings: noteOrders,
    minValue: 0,
    maxValue: 2,
    numberOfSteps: 3,
    defaultValue: 0,
  },

  {
    name: 'Simultaneous Notes',
    type: 'lin',
    minValue: 1,
    maxValue: 16,
    numberOfSteps: 15,
    defaultValue: 1,
  },

  {
    name: 'Note Length',
    unit: '%',
    type: 'linear',
    minValue: 1,
    maxValue: 200,
    defaultValue: 100.0,
    numberOfSteps: 199,
  },

  {
    name: 'Random Length',
    unit: '%',
    type: 'linear',
    minValue: 0,
    maxValue: 200,
    numberOfSteps: 200,
    defaultValue: 0,
  },

  {
    name: 'Random Delay',
    unit: '%',
    type: 'linear',
    minValue: 0,
    maxValue: 200,
    numberOfSteps: 200,
    defaultValue: 0,
  },
];
