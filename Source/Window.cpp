/*
 *  Open Fodder
 *  ---------------
 *
 *  Copyright (C) 2008-2026 Open Fodder
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License along
 *  with this program; if not, write to the Free Software Foundation, Inc.,
 *  51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 */

#include "stdafx.hpp"
#include <sstream>

#ifdef EMSCRIPTEN
#include <map>

/**
 * Touch in the browser
 *
 * A finger on the canvas is the pointer. What pressing it does is chosen by the page's
 * thumb buttons, which sit outside the canvas so SDL never sees them as touches:
 * nothing held moves the squad (left button), FIRE shoots (right button), and THROW
 * throws the squad's grenade or rocket (right button, then left while right is held).
 */
enum eTouchMode {
	eTouchMode_Move = 0,
	eTouchMode_Fire = 1,
	eTouchMode_Throw = 2,
};

static const unsigned int TOUCH_LEFT = 1;
static const unsigned int TOUCH_RIGHT = 2;

struct sTouchFinger {
	unsigned int	mButtons = 0;		// Buttons this finger holds down
	bool			mLeftPending = false;	// A throw's left press, sent once the engine has seen the right button
	cPosition		mPosition;
};

static int sTouchMode = eTouchMode_Move;
static std::map<SDL_FingerID, sTouchFinger> sTouchFingers;
static std::vector<cEvent> sPageEvents;	// Queued by the page shell between frames

static cEvent Touch_ButtonEvent(unsigned int pButton, bool pDown, const cPosition& pPosition) {
	cEvent Event;

	if (pButton == TOUCH_LEFT) {
		Event.mType = pDown ? eEvent_MouseLeftDown : eEvent_MouseLeftUp;
		Event.mButton = 1;
	} else {
		Event.mType = pDown ? eEvent_MouseRightDown : eEvent_MouseRightUp;
		Event.mButton = 3;
	}
	Event.mButtonCount = 1;
	Event.mPosition = pPosition;
	return Event;
}

/**
 * Move a finger to the buttons pMode wants it to hold, releasing and pressing only the difference
 *
 * pStarting is a new touch; a finger already down when the mode changes only lets go when
 * returning to Move, so lifting FIRE while aiming doesn't send the squad to the aim point.
 */
static void Touch_Apply(sTouchFinger& pFinger, int pMode, bool pStarting, std::vector<cEvent>& pEvents) {
	unsigned int Wanted = 0;
	bool LeftPending = false;

	switch (pMode) {
	case eTouchMode_Fire:
		Wanted = TOUCH_RIGHT;
		break;
	case eTouchMode_Throw:
		Wanted = TOUCH_RIGHT;
		LeftPending = true;
		break;
	default:
		Wanted = pStarting ? TOUCH_LEFT : 0;
		break;
	}

	for (unsigned int Button : { TOUCH_LEFT, TOUCH_RIGHT }) {
		if ((pFinger.mButtons & Button) && !(Wanted & Button))
			pEvents.push_back(Touch_ButtonEvent(Button, false, pFinger.mPosition));
	}
	for (unsigned int Button : { TOUCH_RIGHT, TOUCH_LEFT }) {
		if (!(pFinger.mButtons & Button) && (Wanted & Button))
			pEvents.push_back(Touch_ButtonEvent(Button, true, pFinger.mPosition));
	}

	pFinger.mButtons = Wanted;
	pFinger.mLeftPending = LeftPending;
}

static void Touch_Release(sTouchFinger& pFinger, std::vector<cEvent>& pEvents) {
	for (unsigned int Button : { TOUCH_LEFT, TOUCH_RIGHT }) {
		if (pFinger.mButtons & Button)
			pEvents.push_back(Touch_ButtonEvent(Button, false, pFinger.mPosition));
	}
	pFinger.mButtons = 0;
	pFinger.mLeftPending = false;
}

// A throw is right held then left pressed; press left only once the engine has registered right
static void Touch_Deliver(std::vector<cEvent>& pEvents) {
	pEvents.insert(pEvents.end(), sPageEvents.begin(), sPageEvents.end());
	sPageEvents.clear();

	if (!g_Fodder || !g_Fodder->mButtonPressRight)
		return;

	for (auto& Finger : sTouchFingers) {
		if (Finger.second.mLeftPending) {
			Finger.second.mLeftPending = false;
			Finger.second.mButtons |= TOUCH_LEFT;
			pEvents.push_back(Touch_ButtonEvent(TOUCH_LEFT, true, Finger.second.mPosition));
		}
	}
}

// Called by the page shell while a thumb button is held
extern "C" EMSCRIPTEN_KEEPALIVE void of_touch_mode(int pMode) {
	if (pMode < eTouchMode_Move || pMode > eTouchMode_Throw || pMode == sTouchMode)
		return;

	sTouchMode = pMode;
	for (auto& Finger : sTouchFingers)
		Touch_Apply(Finger.second, sTouchMode, false, sPageEvents);
}

// Called by the page shell's buttons: an SDL scancode, pressed or released
extern "C" EMSCRIPTEN_KEEPALIVE void of_key(int pScancode, int pDown) {
	cEvent Event(pDown ? eEvent_KeyDown : eEvent_KeyUp);
	Event.mButton = pScancode;
	sPageEvents.push_back(Event);
}
#endif

cWindow::cWindow() {

	mOriginalResolution.mWidth = 320;
	mOriginalResolution.mHeight = 200;

	mScaler = mScalerPrevious = 2;

	mScreenSize.mWidth = mOriginalResolution.mWidth;
	mScreenSize.mHeight = mOriginalResolution.mHeight;

	mWindowMode = true;

	mWindow = 0;

	mRenderer = 0;

    mHasFocus = true;
	mResized = false;
}

cWindow::~cWindow() {

	SDL_DestroyRenderer( mRenderer );
	SDL_DestroyWindow( mWindow );

	SDL_Quit();
}

bool cWindow::InitWindow( const std::string& pWindowTitle ) {
	
	if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO)) {
        g_Debugger->Error("Failed to initialise SDL");
		exit( 1 );
		return false;
	}
	
    ToggleFullscreen();

	mWindow = SDL_CreateWindow(pWindowTitle.c_str(), GetWindowSize().mWidth, GetWindowSize().mHeight, 0);
	if (!mWindow) {
        g_Debugger->Error("Failed to create window");
		exit( 1 );
		return false;
	}

    PositionWindow();
	mRenderer = SDL_CreateRenderer(mWindow, nullptr);
	if (!mRenderer) {
        g_Debugger->Error("Failed to create rendered");
		exit( 1 );
		return false;
	}

	SDL_SetHintWithPriority(SDL_HINT_MOUSE_RELATIVE_WARP_MOTION, "1", SDL_HINT_OVERRIDE);
	SetMouseSpeed(g_Fodder ? (float)g_Fodder->mStartParams->mMouseSpeed : 1.5f);


    if (g_Fodder->mParams->mWindowMode) {
        ToggleFullscreen();
        CalculateWindowSize();
    }
    else {
        ToggleFullscreen();
        ToggleFullscreen();
    }

	if (!g_Fodder->mParams->mMouseAlternative || (g_Fodder->mParams->mMouseAlternative && g_Fodder->mParams->mMouseLocked)) {
		SDL_SetWindowRelativeMouseMode(mWindow, true);

		// Warp mouse to 0,0 to fix an issue with the mouse cursor appearing on first click in the window
		SDL_WarpMouseInWindow(mWindow, 0, 0);
	}
	
	SDL_HideCursor();

	return true;
}

void cWindow::ToggleVSync(bool pEnabled) {
	#ifdef EMSCRIPTEN
	return;
	#endif
	SDL_SetRenderVSync(mRenderer, pEnabled ? 1 : 0);
}

void cWindow::SetRelativeMouseMode(bool pEnable) {

    if (mWindow) {
        SDL_SetWindowRelativeMouseMode(mWindow, pEnable);
    }
}

void cWindow::SetMouseSpeed(float pSpeed) {
	if (pSpeed < 1.0f)
		pSpeed = 1.0f;
	if (pSpeed > 10.0f)
		pSpeed = 10.0f;

	std::ostringstream speed;
	speed.setf(std::ios::fixed);
	speed.precision(1);
	speed << pSpeed;
	SDL_SetHint(SDL_HINT_MOUSE_RELATIVE_SPEED_SCALE, speed.str().c_str());
}

std::vector<cEvent>* cWindow::EventGet() {
    return &mEvents;
}

bool cWindow::Cycle() {

    EventCheck();


    return true;
}

void cWindow::EventCheck() {
	SDL_Event SysEvent;
    static float sMouseMotionRemainderX = 0.0f;
    static float sMouseMotionRemainderY = 0.0f;

#ifdef EMSCRIPTEN
	Touch_Deliver(mEvents);
#endif

	while (SDL_PollEvent(&SysEvent)) {

		cEvent Event;

#ifdef EMSCRIPTEN
		// Touches arrive as finger events; drop the mouse events SDL synthesizes from them
		if ((SysEvent.type == SDL_EVENT_MOUSE_MOTION && SysEvent.motion.which == SDL_TOUCH_MOUSEID) ||
			((SysEvent.type == SDL_EVENT_MOUSE_BUTTON_DOWN || SysEvent.type == SDL_EVENT_MOUSE_BUTTON_UP) && SysEvent.button.which == SDL_TOUCH_MOUSEID))
			continue;
#endif

		switch (SysEvent.type) {
		case SDL_EVENT_WINDOW_FOCUS_LOST:
			Event.mType = eEvent_Focus;
			Event.mHasFocus = false;
			mHasFocus = false;
			break;

		case SDL_EVENT_WINDOW_FOCUS_GAINED:
			Event.mType = eEvent_Focus;
			Event.mHasFocus = true;
			mHasFocus = true;
			break;
		case SDL_EVENT_WINDOW_MOUSE_ENTER:
			Event.mType = eEvent_MouseEnter;
			break;
		case SDL_EVENT_WINDOW_MOUSE_LEAVE:
			Event.mType = eEvent_MouseLeave;
			break;

		case SDL_EVENT_KEY_DOWN:
			Event.mType = eEvent_KeyDown;
			Event.mButton = SysEvent.key.scancode;
			break;

		case SDL_EVENT_KEY_UP:
			Event.mType = eEvent_KeyUp;
			Event.mButton = SysEvent.key.scancode;
			break;

#ifdef EMSCRIPTEN
		case SDL_EVENT_FINGER_MOTION:
		case SDL_EVENT_FINGER_DOWN:
		case SDL_EVENT_FINGER_UP:
		case SDL_EVENT_FINGER_CANCELED:
		{
			const float X = SDL_clamp(SysEvent.tfinger.x, 0.0f, 1.0f);
			const float Y = SDL_clamp(SysEvent.tfinger.y, 0.0f, 1.0f);
			const cPosition Position((unsigned int)(X * GetWindowWidth()), (unsigned int)(Y * GetWindowHeight()));

			if (SysEvent.type == SDL_EVENT_FINGER_DOWN) {
				auto& Finger = sTouchFingers[SysEvent.tfinger.fingerID];
				Finger.mPosition = Position;

				// Put the pointer on the finger before pressing
				Event.mType = eEvent_MouseMove;
				Event.mPosition = Position;
				mEvents.push_back(Event);
				Event.mType = eEvent_None;

				Touch_Apply(Finger, sTouchMode, true, mEvents);
				break;
			}

			auto Finger = sTouchFingers.find(SysEvent.tfinger.fingerID);
			if (Finger == sTouchFingers.end())
				break;
			Finger->second.mPosition = Position;

			if (SysEvent.type == SDL_EVENT_FINGER_MOTION) {
				Event.mType = eEvent_MouseMove;
				Event.mPosition = Position;
				break;
			}

			// Up or cancelled: let go of whatever this finger pressed
			Touch_Release(Finger->second, mEvents);
			sTouchFingers.erase(Finger);
			break;
		}
#else
		case SDL_EVENT_FINGER_MOTION:
			Event.mType = eEvent_MouseMove;
			Event.mPosition = cPosition((unsigned int)(SysEvent.tfinger.x * GetWindowWidth()),
										(unsigned int)(SysEvent.tfinger.y * GetWindowHeight()));
			break;

		case SDL_EVENT_FINGER_DOWN:
			
			Event.mType = eEvent_MouseLeftDown;
			Event.mButton = 1;
			Event.mPosition = cPosition((unsigned int)(SysEvent.tfinger.x * GetWindowWidth()),
										(unsigned int)(SysEvent.tfinger.y * GetWindowHeight()));

			Event.mButtonCount = 1;

			break;

		case SDL_EVENT_FINGER_UP:
			Event.mType = eEvent_MouseLeftUp;
			Event.mButton = 1;

			Event.mPosition = cPosition((unsigned int)(SysEvent.tfinger.x * GetWindowWidth()),
										(unsigned int)(SysEvent.tfinger.y * GetWindowHeight()));

			Event.mButtonCount = 1;
			mEvents.push_back(Event);

			Event.mType = eEvent_MouseRightUp;
			Event.mButton = 3;

			break;
#endif

		case SDL_EVENT_MOUSE_MOTION:
		{
            sMouseMotionRemainderX += SysEvent.motion.xrel;
            sMouseMotionRemainderY += SysEvent.motion.yrel;
            const int Xrel = (int)sMouseMotionRemainderX;
            const int Yrel = (int)sMouseMotionRemainderY;
            sMouseMotionRemainderX -= (float)Xrel;
			sMouseMotionRemainderY -= (float)Yrel;

			Event.mType = eEvent_MouseMove;
			Event.mPosition = cPosition((int)SysEvent.motion.x, (int)SysEvent.motion.y);
			Event.mPositionRelative = cPosition(Xrel, Yrel);
			break;
		}
		case SDL_EVENT_MOUSE_WHEEL:
			Event.mType = eEvent_MouseWheel;
			Event.mPosition = cPosition((int)SysEvent.wheel.x, (int)SysEvent.wheel.y);
			break;

		case SDL_EVENT_MOUSE_BUTTON_DOWN:

			switch (SysEvent.button.button) {

			case 1:
				Event.mType = eEvent_MouseLeftDown;
				Event.mButton = 1;
				break;

			case 3:
				Event.mType = eEvent_MouseRightDown;
				Event.mButton = 3;
				break;
			}

			Event.mPosition = cPosition((int)SysEvent.button.x, (int)SysEvent.button.y);
			Event.mButtonCount = SysEvent.button.clicks;
			break;

		case SDL_EVENT_MOUSE_BUTTON_UP:

			switch (SysEvent.button.button) {

			case 1:
				Event.mType = eEvent_MouseLeftUp;
				Event.mButton = 1;
				break;

			case 3:
				Event.mType = eEvent_MouseRightUp;
				Event.mButton = 3;
				break;
			}

			Event.mPosition = cPosition((int)SysEvent.button.x, (int)SysEvent.button.y);
			Event.mButtonCount = SysEvent.button.clicks;
			break;

		case SDL_EVENT_QUIT:
			Event.mType = eEvent_Quit;
			break;
		}

#ifdef EMSCRIPTEN
		// Drop events which have no x/y
		if (SysEvent.type == SDL_EVENT_MOUSE_MOTION || 
			SysEvent.type == SDL_EVENT_MOUSE_BUTTON_DOWN || 
			SysEvent.type == SDL_EVENT_MOUSE_BUTTON_UP) {

			if (Event.mPosition.mX == 0 || Event.mPosition.mY == 0)
				continue;
		}
#endif
		if ( Event.mType != eEvent_None )
			mEvents.push_back( Event );
	}
}

void cWindow::CalculateWindowSize() {
	SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
	const SDL_DisplayMode* current = SDL_GetCurrentDisplayMode(display);
	if (!current) {
		return;
	}

	while ((mOriginalResolution.mWidth * mScaler) <= (unsigned int) (current->w / 2) && 
			(mOriginalResolution.mHeight * mScaler) <= (unsigned int) (current->h / 2) ) {
		++mScaler;
	}

	SetWindowSize( mScaler );
}

int16 cWindow::CalculateFullscreenSize() {
	SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
	const SDL_DisplayMode* current = SDL_GetCurrentDisplayMode(display);
	if (!current) {
		return 1;
	}
	int16 Multiplier = 1;

	while ((mOriginalResolution.mWidth * Multiplier) <= (unsigned int) current->w && (mOriginalResolution.mHeight * Multiplier) <= (unsigned int) current->h ) {
		++Multiplier;
	}

	return --Multiplier;
}

bool cWindow::CanChangeToMultiplier( const int pNewMultiplier ) {
	SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
	const SDL_DisplayMode* current = SDL_GetCurrentDisplayMode(display);
	if (!current) {
		return false;
	}

	if (	(mOriginalResolution.getWidth()  * pNewMultiplier >= current->w ||
			mOriginalResolution.getHeight() * pNewMultiplier >= current->h) ||
			pNewMultiplier <= 0 )
		return false;

	return true;
}

void cWindow::FrameEnd() {
    #ifndef EMSCRIPTEN
	SDL_RenderPresent( mRenderer );
    
	SDL_SetRenderDrawColor(mRenderer, 0, 0, 0, 0);
	SDL_RenderClear( mRenderer );
	#else
	SDL_SetRenderDrawColor(mRenderer, 0, 0, 0, 0);
	//SDL_RenderClear( mRenderer );
#endif
}

void cWindow::PositionWindow() {
	
	SDL_SetWindowPosition( mWindow, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED );
}

void cWindow::WindowIncrease() {
	
	if (!mWindowMode)
			return;

	// Once we reach the max window size, go to full screen
	if (!CanChangeToMultiplier( mScaler + 1 )) {

		ToggleFullscreen();
		mWindowMode = false;
		return;
	}

	if (!mWindowMode)
		return;

	SetWindowSize( mScaler + 1 );
}

void cWindow::WindowDecrease() {

	// If we're in full screen mode remove it
	if (!mWindowMode) { 

		mWindowMode = true;
		SetWindowSize(mScaler);
		//ToggleFullscreen();
		return;
	}

	if (!CanChangeToMultiplier(mScaler - 1))
		return;

	SetWindowSize( mScaler - 1 );
}

void cWindow::RenderAt( cSurface* pImage ) {
	SDL_FRect Src, Dest;

	Src.w = (float)mScreenSize.mWidth;
	Src.h = (float)mScreenSize.mHeight;
	Src.x = 16.0f;
	Src.y = 16.0f;

	if (g_Fodder->mParams->mIntegerScaling || mWindowMode) {
		Dest.w = (float)GetWindowSize().mWidth;
		Dest.h = (float)GetWindowSize().mHeight;
	}
	else {
		int windowW = 0;
		int windowH = 0;
		SDL_GetWindowSize(mWindow, &windowW, &windowH);
		Dest.h = (float)windowH;
		Dest.w = (float)(Dest.h * (float)(4.0/3.0));
	}

	if (mWindowMode) {
		Dest.x = 0.0f;
		Dest.y = 0.0f;
	}
	else {
		SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
		const SDL_DisplayMode* current = SDL_GetCurrentDisplayMode(display);
		if (current) {
			Dest.x = (float)((current->w - Dest.w) / 2.0f);
			Dest.y = (float)((current->h - Dest.h) / 2.0f);
		} else {
			Dest.x = 0.0f;
			Dest.y = 0.0f;
		}
	}

	SDL_RenderTexture( mRenderer, pImage->GetTexture(), &Src, &Dest );
}

void cWindow::RenderShrunk( cSurface* pImage ) {
	SDL_FRect Src, Dest;
	Src.w = (float)pImage->GetWidth();
	Src.h = (float)pImage->GetHeight();
	Src.x = 0.0f;
	Src.y = 0.0f;

	Dest.w = (float)GetWindowSize().mWidth;
	Dest.h = (float)GetWindowSize().mHeight;

	if (mWindowMode) {
		Dest.x = 0.0f;
		Dest.y = 0.0f;
	}
	else {
		SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
		const SDL_DisplayMode* current = SDL_GetCurrentDisplayMode(display);
		if (current) {
			Dest.x = (float)((current->w - Dest.w) / 2.0f);
			Dest.y = (float)((current->h - Dest.h) / 2.0f);
		} else {
			Dest.x = 0.0f;
			Dest.y = 0.0f;
		}
	}

	SDL_RenderTexture( mRenderer, pImage->GetTexture(), &Src, &Dest);
}

bool cWindow::isFullscreen() const {
    return !mWindowMode;
}

bool cWindow::isMouseInside() const {
	return mWindow == SDL_GetMouseFocus();
}

bool cWindow::isResized() const {
	return mResized;
}

/**
 * Is either mouse button currently pressed
 */
bool cWindow::isMouseButtonPressed_Global() const {
    return  (SDL_GetMouseState(NULL, NULL) & SDL_BUTTON_MASK(SDL_BUTTON_LEFT)) ||
            (SDL_GetMouseState(NULL, NULL) & SDL_BUTTON_MASK(SDL_BUTTON_RIGHT));
}

/**
 * Is the window currently grabbed
 */
bool cWindow::isGrabbed() const {
    if (!mWindow) {
        return false;
    }
    return SDL_GetWindowMouseGrab(mWindow);
}

void cWindow::ToggleFullscreen() {

	if (mWindowMode) {

		mScalerPrevious = mScaler;
		SetWindowSize( CalculateFullscreenSize() );

        if (mWindow) {
		    SDL_SetWindowFullscreen( mWindow, true );
        }
		mWindowMode = false;
	} else {
		mWindowMode = true;
		SetWindowSize( mScalerPrevious );
	}
}

void cWindow::ClearResized() {
	mResized = false;
}

void cWindow::SetMousePosition(const cPosition& pPosition) {

    SDL_WarpMouseGlobal((float)pPosition.getX(), (float)pPosition.getY());
}

void cWindow::SetMousePositionInWindow(float pX, float pY) {
    if (!mWindow) {
        return;
    }
    SDL_WarpMouseInWindow(mWindow, pX, pY);
}

void cWindow::SetScreenSize( const cDimension& pDimension ) {

	mScreenSize = pDimension;
}

/**
 * Set the window size / resolution using the aspect ratio of the original resolution
 * 
 * @param pDimension Original resolution
 */
void cWindow::SetOriginalRes( const cDimension& pDimension ) {

    if (mOriginalResolution == pDimension)
        return;

	mOriginalResolution = pDimension;
	

	if (!mWindowMode) {
		ToggleFullscreen();
		ToggleFullscreen();
	} else
		SetWindowSize( mScaler );
}

void cWindow::SetWindowTitle( const std::string& pWindowTitle ) {

	SDL_SetWindowTitle( mWindow, pWindowTitle.c_str() );
}

bool cWindow::GetWindowBordersSize(int* pTop, int* pLeft, int* pBottom, int* pRight) const {
    if (!mWindow) {
        if (pTop) *pTop = 0;
        if (pLeft) *pLeft = 0;
        if (pBottom) *pBottom = 0;
        if (pRight) *pRight = 0;
        return false;
    }
    return SDL_GetWindowBordersSize(mWindow, pTop, pLeft, pBottom, pRight);
}

void cWindow::SetWindowSize( const int pMultiplier ) {

	if (pMultiplier < 1 )
		return;

	mScaler = pMultiplier;

	if (mWindow) {
		if (mWindowMode) {
			SDL_SetWindowFullscreen( mWindow, false );
		}
		SDL_SetWindowSize( mWindow, GetWindowSize().mWidth, GetWindowSize().mHeight );
		PositionWindow();
		
		mResized = true;
	}
}

cPosition cWindow::GetWindowPosition() const {
    cPosition Pos;

    SDL_GetWindowPosition(mWindow, &Pos.mX, &Pos.mY);

    return Pos;
}

cDimension cWindow::GetWindowSize() const {
	return cDimension( mOriginalResolution.mWidth * mScaler, mOriginalResolution.mHeight * mScaler ); 
}

int32 cWindow::GetWindowWidth() const {
	return mOriginalResolution.mWidth * mScaler;
}

int32 cWindow::GetWindowHeight() const {
	return mOriginalResolution.mHeight * mScaler;
}

cDimension cWindow::GetScale() const {
    cDimension Result = GetWindowSize() / GetScreenSize();
    if (Result.mHeight == 0)
        Result.mHeight = 1;
    if (Result.mWidth == 0)
        Result.mWidth = 1;
    return Result;
}

float cWindow::GetRefreshRate() {
	SDL_DisplayID display = mWindow ? SDL_GetDisplayForWindow(mWindow) : SDL_GetPrimaryDisplay();
	const SDL_DisplayMode* mode = SDL_GetCurrentDisplayMode(display);
	if (!mode) {
		std::cerr << "SDL_GetCurrentDisplayMode failed: " << SDL_GetError() << std::endl;
		return 50; // Fallback to 50Hz if query fails
	}
	return mode->refresh_rate;
}

bool cWindowNull::InitWindow(const std::string& pWindowTitle) {


    return true;
}
