
        document.addEventListener('DOMContentLoaded', function() {
            // Web Audio API variables - defined at the top level
            let audioContext = null;
            let analyzer = null;
            let microphone = null;
            let gainNode = null;
            let delayNode = null;
            let inverter = null;
            let outputAnalyzer = null;
            let bandpassFilter = null;
            let lowpassFilter = null;
            let directGain = null;
            let isRunning = false;
            
            // DOM elements
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            const audioTestBtn = document.getElementById('audioTestBtn');
            const checkPermBtn = document.getElementById('checkPermBtn');
            const permissionCheck = document.getElementById('permissionCheck');
            const permissionStatus = document.getElementById('permissionStatus');
            const status = document.getElementById('status');
            const phaseShiftInput = document.getElementById('phaseShift');
            const phaseShiftValue = document.getElementById('phaseShiftValue');
            const gainInput = document.getElementById('gain');
            const gainValue = document.getElementById('gainValue');
            const delayInput = document.getElementById('delay');
            const delayValue = document.getElementById('delayValue');
            const lowFreqInput = document.getElementById('lowFreq');
            const lowFreqValue = document.getElementById('lowFreqValue');
            const highFreqInput = document.getElementById('highFreq');
            const highFreqValue = document.getElementById('highFreqValue');
            const inputMeter = document.getElementById('inputMeter');
            const outputMeter = document.getElementById('outputMeter');
            
            // Check and display browser compatibility info
            permissionCheck.style.display = 'block';
            
            // Event listeners
            startBtn.addEventListener('click', startNoiseCancellation);
            stopBtn.addEventListener('click', stopNoiseCancellation);
            audioTestBtn.addEventListener('click', testAudioContext);
            checkPermBtn.addEventListener('click', checkMicrophonePermission);
            phaseShiftInput.addEventListener('input', updatePhaseShift);
            gainInput.addEventListener('input', updateGain);
            delayInput.addEventListener('input', updateDelay);
            lowFreqInput.addEventListener('input', updateLowFreq);
            highFreqInput.addEventListener('input', updateHighFreq);
            
            // Check for browser compatibility
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                permissionStatus.innerHTML = '<span style="color: red;">❌ ERROR: MediaDevices API not supported in this browser. Try Chrome or Edge.</span>';
            } else {
                checkMicrophonePermission();
            }
            
            // Function to test audio context creation
            async function testAudioContext() {
                try {
                    const testContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    // Create a simple oscillator to test audio output
                    const oscillator = testContext.createOscillator();
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(440, testContext.currentTime); // A4 note
                    
                    const testGain = testContext.createGain();
                    testGain.gain.setValueAtTime(0.2, testContext.currentTime); // Low volume
                    
                    oscillator.connect(testGain);
                    testGain.connect(testContext.destination);
                    
                    oscillator.start();
                    setTimeout(() => {
                        oscillator.stop();
                        testContext.close();
                        alert("Audio test completed successfully. If you heard a beep, audio context is working properly.");
                    }, 1000);
                    
                    status.innerHTML = `Audio Context State: ${testContext.state}`;
                } catch (error) {
                    console.error("Audio context test failed:", error);
                    alert(`Audio context test failed: ${error.message}`);
                }
            }
            
            // Function to check microphone permission
            async function checkMicrophonePermission() {
                permissionStatus.innerHTML = 'Checking microphone permissions...';
                
                try {
                    // Try to actually get the media stream as a test
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
                        document.getElementById('permissionStatus').innerHTML = 
                            '<span style="color: green;">✅ Successfully accessed microphone</span>';
                        
                        // Clean up the test stream
                        stream.getTracks().forEach(track => track.stop());
                    } catch (streamError) {
                        document.getElementById('permissionStatus').innerHTML = 
                            `<span style="color: red;">❌ Could not access microphone: ${streamError.message}</span>`;
                    }
                } catch (error) {
                    document.getElementById('permissionStatus').innerHTML = 
                        `<span style="color: red;">❌ Error checking permissions: ${error.message}</span>`;
                }
            }
            
            // Update functions for sliders
            function updatePhaseShift() {
                const value = phaseShiftInput.value;
                phaseShiftValue.textContent = `${value}°`;
                if (isRunning && inverter) {
                    // We can approximate phase shift by adjusting the gain value
                    // Phase inversion (180°) is gain of -1.0
                    // 0° would be gain of 1.0
                    // This is simplified but can allow some adjustment
                    const normalizedPhase = (value - 180) / 180; // -1 to 1 centered around 180°
                    inverter.gain.value = -1.0 + normalizedPhase * 0.5; // Subtle adjustment around -1.0
                }
            }
            
            function updateGain() {
                const value = gainInput.value;
                gainValue.textContent = `${value}%`;
                if (gainNode) {
                    gainNode.gain.value = value / 100 * 3; // Multiply by 3 for more audible effect
                    console.log("Gain updated to:", gainNode.gain.value);
                }
            }
            
            function updateDelay() {
                const value = delayInput.value;
                delayValue.textContent = `${value}ms`;
                if (delayNode) {
                    delayNode.delayTime.value = value / 1000; // Convert ms to seconds
                }
            }
            
            function updateLowFreq() {
                const value = lowFreqInput.value;
                lowFreqValue.textContent = `${value} Hz`;
                if (isRunning && bandpassFilter) {
                    bandpassFilter.frequency.value = value;
                }
            }
            
            function updateHighFreq() {
                const value = highFreqInput.value;
                highFreqValue.textContent = `${value} Hz`;
                if (isRunning && lowpassFilter) {
                    lowpassFilter.frequency.value = value;
                }
            }
            
            // Main functions for starting/stopping noise cancellation
            async function startNoiseCancellation() {
                try {
                    // Log browser information for debugging
                    console.log("Browser:", navigator.userAgent);
                    
                    // Make sure we have access to required APIs
                    if (!window.AudioContext && !window.webkitAudioContext) {
                        throw new Error("AudioContext not supported in this browser");
                    }
                    
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                        throw new Error("MediaDevices API not supported in this browser");
                    }
                    
                    // Create audio context - with user interaction to avoid autoplay policy issues
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    
                    // iOS Safari often requires direct user interaction to start audio context
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                    }
                    
                    console.log("Audio context state:", audioContext.state);
                    
                    // Different approach to microphone permissions based on browser
                    const constraints = { 
                        audio: {
                            // Less constraints for better compatibility
                            echoCancellation: false,
                            noiseSuppression: false,
                            autoGainControl: false
                        }
                    };
                    
                    console.log("Requesting microphone with constraints:", JSON.stringify(constraints));
                    
                    // Get microphone access
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    console.log("Got media stream:", stream.active ? "active" : "inactive");
                    
                    // Display microphone tracks info for debugging
                    stream.getAudioTracks().forEach(track => {
                        console.log("Audio track:", track.label);
                        console.log("Track settings:", JSON.stringify(track.getSettings()));
                        console.log("Track constraints:", JSON.stringify(track.getConstraints()));
                    });
                    
                    microphone = audioContext.createMediaStreamSource(stream);
                    console.log("Microphone source created successfully");
                    
                    // Create analyzer for input monitoring
                    analyzer = audioContext.createAnalyser();
                    analyzer.fftSize = 2048;
                    microphone.connect(analyzer);
                    
                    // Create bandpass filter to focus on target frequencies
                    bandpassFilter = audioContext.createBiquadFilter();
                    bandpassFilter.type = "bandpass";
                    bandpassFilter.frequency.value = lowFreqInput.value;
                    bandpassFilter.Q.value = 0.7;
                    
                    // Create lowpass filter to reduce high frequency feedback
                    lowpassFilter = audioContext.createBiquadFilter();
                    lowpassFilter.type = "lowpass";
                    lowpassFilter.frequency.value = highFreqInput.value;
                    
                    // Create delay node (for fine-tuning timing)
                    delayNode = audioContext.createDelay(1);
                    delayNode.delayTime.value = delayInput.value / 1000;
                    
                    // Create gain node for controlling output volume (start with lower gain)
                    gainNode = audioContext.createGain();
                    gainNode.gain.value = gainInput.value / 100;
                    
                    // Create phase inverter (a gain node with negative gain inverts the phase)
                    inverter = audioContext.createGain();
                    inverter.gain.value = -1.0; // Invert the signal (180° phase shift)
                    
                    // Create output analyzer
                    outputAnalyzer = audioContext.createAnalyser();
                    outputAnalyzer.fftSize = 2048;
                    
                    // Create a bandpass filter to limit feedback
                    bandpassFilter = audioContext.createBiquadFilter();
                    bandpassFilter.type = "bandpass";
                    bandpassFilter.frequency.value = lowFreqInput.value; // Focus on mid-range frequencies
                    bandpassFilter.Q.value = 0.7; // Moderate Q factor

                    // Create a low-pass filter to further reduce feedback
                    lowpassFilter = audioContext.createBiquadFilter();
                    lowpassFilter.type = "lowpass";
                    lowpassFilter.frequency.value = highFreqInput.value; // Limit higher frequencies

                    // Setup direct monitoring if not already created
                    if (!directGain) {
                        directGain = audioContext.createGain();
                        directGain.gain.value = 0; // Start with monitoring off
                        microphone.connect(directGain);
                        directGain.connect(audioContext.destination);
                        
                        console.log("Direct microphone monitoring created");
                        
                        // Show and setup the monitoring button
                        const monitorBtn = document.getElementById('monitorBtn');
                        if (monitorBtn) {
                            monitorBtn.style.display = 'block';
                            monitorBtn.addEventListener('click', function() {
                                if (directGain.gain.value > 0) {
                                    directGain.gain.value = 0;
                                    monitorBtn.textContent = 'Enable Direct Monitoring';
                                } else {
                                    directGain.gain.value = 0.5;
                                    monitorBtn.textContent = 'Disable Direct Monitoring';
                                }
                            });
                        }
                    }
                    
                    // Connect the nodes with filtering:
                    // microphone -> bandpass -> lowpass -> delay -> inverter -> gain -> outputAnalyzer -> output
                    microphone.connect(bandpassFilter);
                    bandpassFilter.connect(lowpassFilter);
                    lowpassFilter.connect(delayNode);
                    delayNode.connect(inverter);
                    inverter.connect(gainNode);
                    gainNode.connect(outputAnalyzer);
                    gainNode.connect(audioContext.destination);
                    
                    // Update UI
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                    status.className = 'status active';
                    status.textContent = 'Status: Active - Noise Cancellation Running';
                    
                    // Start visualization
                    isRunning = true;
                    updateMeters();
                    
                } catch (error) {
                    // More detailed error message
                    const errorMessage = `Microphone access error: ${error.name}: ${error.message}
                    
    - Make sure microphone permissions are enabled in browser settings
    - Try using a different browser (Chrome often works best)
    - If using HTTPS, make sure your connection is secure
    - Refresh the page and try again
                    
    Technical details: ${error.toString()}`;
                    
                    console.error("Microphone access error:", error);
                    status.className = 'status inactive';
                    status.innerHTML = `Error: ${error.name}<br><small>${error.message}</small>`;
                    
                    alert(errorMessage);
                }
            }
            
            function stopNoiseCancellation() {
                if (audioContext) {
                    // Disconnect everything
                    if (microphone) microphone.disconnect();
                    if (bandpassFilter) bandpassFilter.disconnect();
                    if (lowpassFilter) lowpassFilter.disconnect();
                    if (delayNode) delayNode.disconnect();
                    if (inverter) inverter.disconnect();
                    if (gainNode) gainNode.disconnect();
                    if (outputAnalyzer) outputAnalyzer.disconnect();
                    if (directGain) directGain.disconnect();
                    
                    // Reset directGain to null so it can be recreated
                    directGain = null;
                    
                    // Close audio context
                    audioContext.close();
                    audioContext = null;
                }
                
                // Update UI
                startBtn.disabled = false;
                stopBtn.disabled = true;
                status.className = 'status inactive';
                status.textContent = 'Status: Inactive';
                
                // Hide the monitor button
                const monitorBtn = document.getElementById('monitorBtn');
                if (monitorBtn) {
                    monitorBtn.style.display = 'none';
                }
                
                isRunning = false;
                
                // Reset meters
                inputMeter.style.width = '0%';
                outputMeter.style.width = '0%';
            }
            
            function updateMeters() {
                if (!isRunning) return;
                
                // Update input meter
                if (analyzer) {
                    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                    analyzer.getByteTimeDomainData(dataArray);
                    
                    // Calculate RMS (root mean square) for a better volume representation
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        const normalized = (dataArray[i] / 128) - 1;
                        sum += normalized * normalized;
                    }
                    const rms = Math.sqrt(sum / dataArray.length);
                    const inputLevel = Math.min(100, rms * 400); // Scale to percentage
                    inputMeter.style.width = inputLevel + '%';
                }
                
                // Update output meter
                if (outputAnalyzer) {
                    const dataArray = new Uint8Array(outputAnalyzer.frequencyBinCount);
                    outputAnalyzer.getByteTimeDomainData(dataArray);
                    
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        const normalized = (dataArray[i] / 128) - 1;
                        sum += normalized * normalized;
                    }
                    const rms = Math.sqrt(sum / dataArray.length);
                    const outputLevel = Math.min(100, rms * 400);
                    outputMeter.style.width = outputLevel + '%';
                }
                
                requestAnimationFrame(updateMeters);
            }
        });
    